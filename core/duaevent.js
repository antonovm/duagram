const EventEmitter = require('events');
const DuaMessage = require('./duamessage');
const { terminal } = require('../utils/log');
const { StringSession, StoreSession } = require("telegram/sessions");
const { pbkdf2Sync } = require('crypto');

const keygen = (str, len = 8) => {
    let key = pbkdf2Sync(str, 'dg', 100000, len, 'sha256');
    return '.dg' + key.toString('hex');
}


const removeNull = (obj) => {
    Object.keys(obj).forEach(k =>
        (obj[k] && typeof obj[k] === 'object') && removeNull(obj[k])
        ||
        !obj[k] && delete obj[k]
    );
    return obj;
};

class DuaEvent extends EventEmitter {
    constructor() {
        super();
        this.DuaMessage = DuaMessage;
        this.asBotApi;
        this.cmdPrefix = "!./";
        this.BotApi = false;
        this.client = false;
        this.scanners = [];
        this.middlewares = [];
        this.terminal = terminal;

        this.session_type;
        this.keygen = keygen;
    }

    async makeSession() {
        let options = this.options;
        this.session_type = 'memory';
        let session = new StringSession(options.session);
        await session.load();

        if (!options.local) return session;

        let session_name = options.session_name || this.keygen(options.session);
        let local = new StoreSession(session_name);

        local.setDC(
            session.dcId,
            session.serverAddress,
            session.port
        )

        local.setAuthKey(
            session.authKey
        )

        this.session_type = 'local';
        return local;
    }

    init(options) {
        try {
            if (typeof options !== 'object') throw Error('Please, check documentation to starting bot.');
            if (!options.api_id) throw Error('api_id is required.');
            if (!options.api_hash) throw Error('api_hash is required.');

            if (options.as_bot_api && !options.bot_token) throw new Error("bot_api required!");
            // if (!options.as_bot_api && !options.session) throw new Error("session required!");

            if (parseInt(options.api_id) < 5000) throw Error('api_id - mistake, get it from https://my.telegram.org');
            if (options.as_bot_api && options.bot_token.length < 20) throw Error('bot_token - mistake, get it from @botfather')

            if (options.cmdPrefix) {
                this.cmdPrefix = options.cmdPrefix;
            }

            options.useWSS = options.useWSS || false;

            options.session = options.session || '';
            options.session_name = options.session_name || false;
            options.logDetail = options.logDetail || 'debug';
            options.logLevel = options.logLevel || 1;
            options.floodSleepThreshold = options.floodSleepThreshold || 120;

            options.connectionRetries = options.connectionRetries || 3;
            options.markRead = options.hasOwnProperty('markRead') ? options.markRead : true;

            options.more = options.more || {};
            this.options = options;

        } catch (error) {
            this.terminal.error(error.message);
            this.terminal.warn('Please, check your options again.');
            process.exit();
        }
    }

    escapeRegExp(str) {
        if (typeof str === 'string')
            return str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
                .replace(/-/g, '\\x2d');
        return str;
    }

    fieldType(data) {
        if (!data) return false;
        let type = data.className.replace('Peer', '').toLowerCase();
        return {
            type,
            id: data[type + 'Id']
        }
    }

    async processMessage(ctx) {
        const _ctx = ctx;
        ctx = ctx.message;
        let more = {};

        /* let eventKey = [];
        for (key in _ctx) {
            eventKey.push(key);
        } */

        let from = ctx.fromId ? this.fieldType(ctx.fromId) : false;
        let peer = ctx.peerId ? this.fieldType(ctx.peerId) : false;

        let forward_from = false;
        if (ctx.fwdFrom) {
            let type = false;
            let id = false;
            if (ctx.fwdFrom.fromId) {
                type = ctx.fwdFrom.fromId.className == 'PeerUser' ? 'user' : 'channel';
                id = ctx.fwdFrom.fromId[`${type}Id`];
            }
            let { date, fromName } = ctx.fwdFrom;
            forward_from = {
                type,
                id,
                date,
                name: fromName,
            }
        }

        let ids = [ctx.id];

        if (ctx.replyTo) {
            let id = ctx.replyTo.replyToMsgId;
            ids.push(id);
            more.reply = id;
        };


        let update = await this.getMessages(peer.id, ids);

        more = { peer, from, forward: forward_from, ...more };
        let context = new DuaMessage(update, more).context;

        let result = {
            peer,
            from,
            forward_from,
            ...context
        };
        result = removeNull(result);
        this.processMiddleware(result, _ctx);
    }

    addMessageFromMe(update) {
        // split off media
        let media = {};
        if (update.media) {
            media.main = update.media;
            delete update.media;
        }

        if (update.reply_to_message?.media) {
            media.reply = update.reply_to_message.media;
            delete update.reply_to_message.media;
        }

        let result = JSON.stringify(update);
        let me = JSON.stringify(this.me.short);
        result = result.replace(/"from":"me"/g, `"from": ${me}`);
        result = JSON.parse(result);

        // merge media
        if (media.main)
            result.media = media.main;
        if (media.reply)
            result.reply_to_message.media = media.reply;


        result = removeNull(result);

        if (this.options.markRead && !this.options.as_bot_api) {
            this.telegram.readHistory(result);
        }

        return result;
    }

    processMiddleware(update, _ctx) {
        let _update = update;

        update = this.addMessageFromMe(update, _ctx);
        update = this.buildOn(update);

        // middleware process
        if (this.middlewares.length === 0) {
            this.emit('message', update, _ctx);
            return this.scanningText(update, _ctx);
        }

        const nextFunction = (update, index = 1) => {
            return () => {
                if (!this.middlewares[index]) {
                    this.emit('message', update, _ctx);
                    return this.scanningText(update, _ctx);
                }

                return this.middlewares[index](update, nextFunction(update, index + 1));
            }
        }
        return this.middlewares[0](update, nextFunction(update));
    }

    scanningText(update, _ctx) {
        // if (update.media) this.emit('media', update, _ctx);

        if (update.event.length > 0) update.event.forEach(type => this.emit(type, update, _ctx));

        if (!update.text) return;
        let text = update.text;
        let found = false; let matchPattern = [];
        let walk = true;

        if (this.scanners.length <= 0) return false;

        this.scanners.forEach((scanner) => {
            let { key, callback, stop } = scanner;
            // this.terminal.debug('scanning:', `${key} match with ${text}?`);
            if (!walk) return;
            if (key instanceof RegExp) {
                let match;
                if (match = key.exec(text)) {
                    found = true; walk = stop;
                    matchPattern.push(key);
                    update.match = match;
                    return callback(update, _ctx);
                }
            }
            if (key == text) {
                found = true; walk = stop;
                matchPattern.push(key);
                return callback(update, _ctx);
            }

        });
        if (this.logLevel > 0 && found && matchPattern.length > 0) {
            matchPattern.forEach(key => this.terminal.debug(`Match [${key}]: ${text}`));
        }
        return found;
    }

    hear(key, callback, stop = true) {
        return this.scanners.push({ key, callback, stop })
    }

    hears(key, callback, stop = true) {
        return this.scanners.push({ key, callback, stop })
    }

    cmd(str, callback, stop = true) {
        let key = new RegExp(`^[${this.escapeRegExp(this.cmdPrefix)}]${str}$`, "i");
        return this.scanners.push({ key, callback, stop })
    }

    command(str, callback, stop = true) {
        let key = new RegExp(`^[${this.escapeRegExp(this.cmdPrefix)}]${str}$`, "i");
        return this.scanners.push({ key, callback, stop })
    }

    middleware(callback) {
        this.middlewares.push(callback);
    }

    use(callback) {
        this.middlewares.push(callback);
    }

}

module.exports = DuaEvent;