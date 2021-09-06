function typeCheck(value) {
    const return_value = Object.prototype.toString.call(value);
    // we can also use regex to do this...
    const type = return_value.substring(
        return_value.indexOf(" ") + 1,
        return_value.indexOf("]"));

    return type.toLowerCase();
}

function fieldType(data) {
    if (!data) return false;
    //let type = data.className == 'PeerUser' ? 'user' : 'channel';
    let type = data.className.replace('Peer', '').toLowerCase();
    return {
        type,
        id: data[type + 'Id']
    }
}

module.exports = (ctx, event = 'none') => {

    if (!ctx) throw Error('Unknown peer');

    if (typeCheck(ctx) == 'number' || typeCheck(ctx) == 'string') {
        return ctx;
    }

    if (ctx.chat && ctx.chat.id) {
        return ctx.chat.id;
    }

    if (ctx.peerId) {
        let peer = fieldType(ctx.peerId);
        return peer.id;
    }

    if (typeof ctx.peer?.id == 'number') {
        return ctx.peer?.id;
    }

    if (typeof ctx.chat?.id == 'number') {
        return ctx.chat?.id;
    }

    if (typeof ctx.message?.message?.peerId?.userId == 'number') {
        return ctx.message?.peerId?.userId;
    }

    if (typeof ctx.message?.peerId?.userId == 'number') {
        return ctx.message?.peerId?.userId;
    }

    if (typeof ctx.peerId?.userId == 'number')
        return ctx.peerId?.userId;

    if (typeof ctx.message?.message?.peerId?.channelId == 'number')
        return ctx.message?.peerId?.channelId;

    if (typeof ctx.message?.peerId?.channelId == 'number')
        return ctx.message?.peerId?.channelId;

    if (typeof ctx.peerId?.channelId == 'number')
        return ctx.peerId?.channelId;

    if (typeof ctx.peerId?.chatId == 'number')
        return ctx.peerId?.chatId;

    // letakkan akhir
    if (ctx.userId)
        if (typeof ctx.userId == 'number')
            return ctx.userId;

    if (ctx.channelId)
        if (typeof ctx.channelId == 'number')
            return ctx.channelId;

    console.log('==> PEEER TIDAK DIKETAHUI', ctx)
    return ctx;
}