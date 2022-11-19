'use strict';

const availableColors = ["lightblue", "pink", "lightgreen"];
function random_color() { return availableColors[Math.floor(Math.random()*availableColors.length)]; }

class Deferred {
    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }
}

class Server {
    _connected = false
    username = null
    on = {}
    voiceConnection = {} // One RTCPeerConnection per user, with our connection to them in some stage of being set up or connected
    remoteVoiceOffer = {} // One Deferred per user, with their offer. Can arrive before or after our first message to them.
    constructor(roomId, username) {
        this.roomId = roomId;
        this.promiseConnected = new Promise((resolve, reject) => {
            this.onConnected = resolve;
        });
        this.on.whoareyou = this.sendIntroduction.bind(this);
        this.on.letstalk = this.getVoiceOffer.bind(this);
    }
    connect(username) {
        if (this.username) return; // Already started login
        this.username = username;
        this.color = random_color();
        this.websocketListen();
    }
    waitForVoiceOffer(u) {
        return this.remoteVoiceOffer[u] ||= new Deferred();
    }
    async connectVoice(p) {
        const {pc, offer, constraints} = await this.createVoiceOffer();
        pc.username = p.username;
        this.voiceConnection[p.username] = pc;
        this.sendVoiceOffer(p.username, offer);
        const remoteOffer = await this.waitForVoiceOffer(p.username).promise;
        //console.log("got remote offer", remoteOffer);
        await pc.setRemoteDescription(remoteOffer);
    }
    getVoiceOffer(p) {
        //console.log("getVoiceOffer", p);
        this.waitForVoiceOffer(p.username).resolve(p.offer);
        if (p.to != this.username) return;
    }
    async createVoiceOffer() {
        const pc = new RTCPeerConnection();
        const constraints = {};
        const localStream = await this.getMedia(constraints);
        pc.addEventListener('icecandidate', e => this.onWsIceCandidate(pc, e));
        pc.addEventListener('iceconnectionstatechange', e => this.onWsIceStateChange(pc, e));
        pc.addEventListener('track', e => this.onWsGotRemoteStream(pc, e));
        localStream.getTracks().forEach((track) => {
            pc.addTrack(track, localStream);
        });
        const offer = await pc.createOffer({
            offerToReceiveAudio: 1,
            offerToReceiveVideo: 0,
        });
        await pc.setLocalDescription(offer);
        return {pc, offer, constraints}
    }
    onWsIceCandidate(pc, e) {
        //console.log("onWsIceCandidate", pc, e);
    }
    onWsIceStateChange(pc, e) {
        //console.log("onWsIceStateChange", pc, e);
    }
    onWsGotRemoteStream(pc, e) {
        //console.log("onWsGotRemoteStream", pc, e);
        if (this.on.voiceconnect) this.on.voiceconnect({
            track: e.streams[0],
            username: pc.username,
        });
    }
    getMedia() { // return a promise
        return navigator.mediaDevices.getUserMedia({ video: false, audio: true });
    }
    websocketListen(username) {
        const host = window.origin.split("//")[1];
        this.ws = new WebSocket(`ws://${host}${window.wsPrefix}/ws/hang/${this.roomId}`);
        this.ws.addEventListener("message", this.onWsMessage.bind(this));
        this.ws.addEventListener("open", this.onWsOpen.bind(this));
        this.ws.addEventListener("error", this.onWsError.bind(this));
    }
    onWsOpen(ev) {
        if (this.on.wsopen) this.on.wsopen(ev);
        if(this._connected) return;
        this.onConnected();
        this._connected = true;
        this.sendConnect(this.username);
    }
    onWsError(ev) {
        console.log("[ws error]", ev);
        if (this.on.wserror) this.on.wserror(ev);
    }
    onWsMessage(ev) {
        //console.log("[ws message]", ev.data, typeof(ev.data));
        const data = JSON.parse(ev.data);
        if (this.on.wsmessage) this.on.wsmessage(data);
        const type = data.type
        if (this.on[data.type]) this.on[data.type](data)
        else if (this.on.unhandled) this.on.unhandled(data);
    }
    send(data, success) { // We could use the websocket for this too, but python's multitasking isn't great
        $.ajax({
            url: `${window.ajaxPrefix}/ajax/hang/${this.roomId}/send`,
            method: "POST",
            data: JSON.stringify(data),
            dataType: 'json',
            contentType: 'application/json',
            success: success
        });
    }
    sendChatMessage(message) {
        this.send({
            type: "chatmessage",
            username: this.username,
            color: this.color,
            message: message,
        })
    }
    sendConnect() {
        this.send({
            type: "whoareyou",
        })
        this.sendIntroduction()
    }
    sendIntroduction() {
        this.send({
            type: "hello",
            color: this.color,
            username: this.username,
        })
    }
    sendVoiceOffer(username, offer) {
        this.send({
            type: "letstalk",
            username: this.username,
            to: username,
            offer,
        });
    }
}

$(document).ready(() => {
    const roomId = window.location.href.split("/").slice(-1)[0];
    const server = window.server = new Server(roomId);

    // Log in logic
    function updateUsername() {
        const username = $(".username").val();
        if (username) {
            server.connect(username);
        }
    }
    updateUsername();
    server.promiseConnected.then(() => {
        $(".chat").addClass("logged-in");
        $(".chat-message").focus();
    });
    $(".set-username").on("click", updateUsername);
    $(".username").on('keyup', (event) => { if (event.which == 13) updateUsername(); });
    $(".username").focus();

    // UI
    function showSpecial(p, s) {
        return showMessage({username: p.username||p.type, message: s||JSON.stringify(p), type: p.type, color: p.color});
    }
    function showMessage(m) {
        const messagebox = $(".message-box");
        const div = $(`<div class="message message-${m.type}"><div class="message-from">${m.username}</div><div class="message-text">${m.message}</div></div>`);
        if (m.color) div.css("background-color", m.color);
        messagebox.append(div);
        messagebox.scrollTop(messagebox[0].scrollHeight);
    }
    function addUser(p) {
        const userbox = $(".user-box");
        const div = $(`<div class="user" style="background-color: ${p.color||"lightyellow"};">${p.username}<audio autoplay></audio></div>`);
        userbox.append(div);
        return div;
    }

    // Debug logic
    //server.on.wsopen = showSpecial;
    //server.on.wsmessage = showSpecial;
    server.on.wserror = showSpecial;
    server.on.unhandled = showSpecial;

    // User logic
    const seenUsers = {};
    server.on.hello = (p) => {
        if (seenUsers[p.username]) return;
        // New user
        showSpecial(p, "enters the room");
        seenUsers[p.username] = addUser(p);
        server.connectVoice(p);
    };

    // Chat logic
    function updateMessage() {
        const message = $(".chat-message").val();
        $(".chat-message").val("");
        if (!message) return;
        server.sendChatMessage(message);
    }
    $(".send-chat-message").on("click", updateMessage);
    $(".chat-message").on('keyup', (event) => { if (event.which == 13) updateMessage(); });
    server.on.chatmessage = showMessage;

    // Voice logic
    server.on.voiceconnect = (p) => {
        console.log("voiceconnect", p);
        const audio = $(seenUsers[p.username]).find("audio");
        console.log(audio);
        if (audio[0].srcObject !== p.track) audio[0].srcObject = p.track;
    };
});
