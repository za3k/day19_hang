'use strict';

const availableColors = ["lightblue", "pink", "lightgreen", "yellow", "aquamarine", "azure", "blanchedalmond", "coral", "cornsilk", "darkgray", "darkorange", "floralwhite", "gold", "goldenrod", "khaki", "lawngreen", "lavenderblush", "lavender", "lightcyan", "lightskyblue", "lightsalmon", "lightpink", "linen", "mediumturquoise", "mediumspringgreen", "palegoldenrod", "palegreen", "paleturquoise", "peachpuff", "plum", "powderblue", "salmon", "sandybrown", "seashell", "silver", "skyblue", "snow", "springgreen", "ta", "thistle", "wheat", "violet", "yellow", "turquoise", "yellowgreen", "whitesmoke"];
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
    constructor(roomId, username) {
        this.roomId = roomId;
        this.promiseConnected = new Promise((resolve, reject) => {
            this.onConnected = resolve;
        });
        this.on.whoareyou = (p) => {
            this.sendIntroduction();
            if (p.username !== this.username) this.connectVoice(p);
        };
        this.on.letstalk = this.getVoiceOffer.bind(this);
        this.on.answer = this.getVoiceAnswer.bind(this);
        this.on.icecandidate = this.getIceCandidate.bind(this);
    }
    connect(username) {
        if (this.username) return; // Already started login
        this.username = username;
        this.color = random_color();
        this.websocketListen();
    }
    websocketListen(username) {
        const host = window.origin.split("//")[1];
        const protocol = (host.includes("localhost") ? "ws" : "wss");
        this.ws = new WebSocket(`${protocol}://${host}${window.wsPrefix}/ws/hang/${this.roomId}`);
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
        const data = JSON.parse(ev.data);
        if (this.on.wsmessage) this.on.wsmessage(data);
        const type = data.type
        if (data.to && data.to !== this.username) return;
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
            username: this.username,
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
    sendVoiceAnswer(username, answer) {
        this.send({
            type: "answer",
            username: this.username,
            to: username,
            answer,
        });
    }
    sendIceCandidate(username, candidate) {
        this.send({
            type: "icecandidate",
            username: this.username,
            to: username,
            candidate,
        });
    }

    /*===================== Web RTC ================== */
    voiceConnection = {} // One RTCPeerConnection per user, with our connection to them in some stage of being set up or connected
    remoteVoiceAnswer = {} // One Deferred per user, with their offer. Can arrive before or after our first message to them.
    waitForVoiceAnswer(u) {
        return this.remoteVoiceAnswer[u] ||= new Deferred();
    }
    async getPc(u) {
        if (!this.voiceConnection[u]) {
            const pc = this.voiceConnection[u] = await this.createVoiceOffer(u);
            pc.username = u;
        }
        return this.voiceConnection[u];
    }
    async getMedia() { // return a promise
        try {
            return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch(e) {}
        try {
            return await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch(e) {}
        return await navigator.mediaDevices.getUserMedia({ video: true });
    }
    async createVoiceOffer(username) {
        const configuration = {
            'iceServers': [{'urls': 'stun:stun.l.google.com:19302'}]
        };
        const pc = new RTCPeerConnection(configuration);
        pc.username = username;

        pc.addEventListener('icecandidate', e => {
            this.sendIceCandidate(pc.username, e.candidate);
        });
        pc.addEventListener('connectionstatechange', e => {
            //console.log("onIceStateChange", pc, e);
        });
        pc.addEventListener('track', e => {
            if (this.on.voiceconnect) this.on.voiceconnect({
                stream: e.streams[0],
                username: pc.username,
            });
        });
        const localStream = await this.getMedia();
        localStream.getTracks().forEach((track) => {
            pc.addTrack(track, localStream);
        }); // For some reason, if there are no tracks (permission denied) or they're added later, we don't receive anything
        return pc;
    }
    // Calling end
    async connectVoice(p) {
        console.log("connectVoice:start");
        const pc = await this.getPc(p.username);

        const offer = await pc.createOffer({
            offerToReceiveAudio: 1,
            offerToReceiveVideo: 1,
        });
        console.log("connectVoice:offer", offer);
        await pc.setLocalDescription(offer);
        this.sendVoiceOffer(p.username, offer);
        const remoteAnswer = await this.waitForVoiceAnswer(p.username).promise;
        console.log("connectVoice:offer", remoteAnswer);
        const answerDesc = new RTCSessionDescription(remoteAnswer);
        await pc.setRemoteDescription(answerDesc);
        console.log("connectVoice:done")
    }
    // Receiving end
    async getVoiceOffer(p) {
        console.log("getVoiceOffer:start")
        const pc = await this.getPc(p.username);
        console.log("getVoiceOffer:offer", p.offer)
        const offerDesc = new RTCSessionDescription(p.offer);
        await pc.setRemoteDescription(offerDesc);
        const answer = await pc.createAnswer();
        console.log("getVoiceOffer:answer", answer)
        await pc.setLocalDescription(answer);
        this.sendVoiceAnswer(p.username, answer);
        console.log("getVoiceOffer:done")
    }
    async getVoiceAnswer(p) {
        this.waitForVoiceAnswer(p.username).resolve(p.answer);
    }
    async getIceCandidate(p) {
        const pc = await this.getPc(p.username);
        // Some remaining problem here, not sure.
        await pc.addIceCandidate(p.candidate);
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
        const div = $(`<div class="user" style="background-color: ${p.color};"><span style="background-color: ${p.color}">${p.username}</span></div>`);
        if (p.username != server.username) {
            const video = $(`<video class="feed" autoplay playsinline></video>`);
            div.append(video);
        }
        userbox.append(div);
        return div;
    }

    // Debug logic
    server.on.wserror = showSpecial;
    server.on.unhandled = showSpecial;

    // User logic
    const seenUsers = window.seenUsers = {};

    server.on.hello = (p) => { // New user
        if (seenUsers[p.username]) return;
        showSpecial(p, "enters the room");
        seenUsers[p.username] = addUser(p);
    };

    // Chat logic
    function updateMessage() { // Send message
        const message = $(".chat-message").val();
        $(".chat-message").val("");
        if (!message) return;
        server.sendChatMessage(message);
    }
    $(".send-chat-message").on("click", updateMessage);
    $(".chat-message").on('keyup', (event) => { if (event.which == 13) updateMessage(); });
    server.on.chatmessage = showMessage;

    // Voice logic
    server.on.voiceconnect = (p) => { // New video/audio
        const feed = $(seenUsers[p.username]).find(".feed");
        if (feed[0].srcObject !== p.stream) feed[0].srcObject = p.stream;
    };
});
