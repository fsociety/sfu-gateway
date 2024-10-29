export default class SocketClient {
    constructor(options) {
        const self = this;
        this.options = {
            socketUrl: 'ws://localhost:3000',
            onMessage: null,
            ...options
        };

        this.eventHandlers = {};
        this.socket = new WebSocket(this.options.socketUrl);

        this.socket.onopen = function () {
            console.log("ws-open");
        }

        this.socket.onerror = function (error) {
            console.error("ws-error ", error);
        }

        this.socket.onmessage = (event) => {
            const response = JSON.parse(event.data);
            const handler = this.eventHandlers[response.id];
            if (handler) {
                handler(response);
            } else {
                if (this.options.onMessage) this.options.onMessage(response);
            }
        };
    }

    get randomId() {
        return Math.random().toString(36).substring(7);
    }

    call(method, params, handler) {
        if (!params) params = {};

        const request = {
            jsonrpc: "2.0",
            id: this.randomId,
            method: method,
            params: params
        };

        if (this.socket.readyState < 1) {
            console.error('Socket not ready, readyState: ' + this.socket.readyState);
        } else {
            // We have a socket and it should be ready to send on.
            this.socket.send(JSON.stringify(request));
            if (handler) this.eventHandlers[request.id] = handler;
        }
    }
}