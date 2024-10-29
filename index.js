import express from 'express';
import http, { get } from 'http';
import { WebSocketServer } from 'ws';
import wrtc from '@roamhq/wrtc';

const { RTCPeerConnection, RTCSessionDescription } = wrtc;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const createRandomId = () => Math.random().toString(36).substring(7);

let rooms = {};
let publishers = [];
let subscribers = [];

app.get('/', (req, res) => {
    res.send('Hello World!');
});

const rpcMethods = {
    publish: async (options) => {
        const { sdp, room, ws, requestId } = options;
        let publisher = {
            id: createRandomId(),
            room,
            peerConnection: null,
            ws,
        };
        publisher.peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.stunprotocol.org' }] });
        publisher.peerConnection.ontrack = (event) => {
            console.log(`New track for publisher ${publisher.id}`);
            const stream = event.streams[0];
            publisher.stream = stream;
        }

        publisher.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.warn('New ICE candidate:', event.candidate);
                ws.send(sendJsonRpcResponse(requestId, { id: publisher.id, candidate: event.candidate, ptype: 'publisher' }));
            }
        }

        await publisher.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await publisher.peerConnection.createAnswer();
        publisher.peerConnection.setLocalDescription(answer);
        if (!rooms[room]) rooms[room] = [];
        const usersInRoom = rooms[room].map(user => user.id);
        publishers.push(publisher);
        rooms[room].push(publisher);
        if (usersInRoom.length > 0) {
            rooms[room].forEach((user) => {
                if (user.id !== publisher.id) {
                    const request = {
                        jsonrpc: "2.0",
                        id: createRandomId(),
                        method: "newPublisher",
                        params: {
                            id: publisher.id,
                            room
                        }
                    };
                    user.ws.send(JSON.stringify(request));
                }
            });
        }
        return { id: publisher.id, room, sdp: publisher.peerConnection.localDescription, usersInRoom };
    },
    candidate: async (options) => {
        const { id, candidate, ptype } = options;
        if (ptype === 'publisher') {
            const publisher = publishers.find(publisher => publisher.id === id);
            if (!publisher) return;
            await publisher.peerConnection.addIceCandidate(candidate);
        } else {
            const subscriber = subscribers.find(subscriber => subscriber.id === id);
            if (!subscriber) return;
            await subscriber.peerConnection.addIceCandidate(candidate);
        }
    },
    subscribe: async (options) => {
        const { pid, sid, sdp, room, ws, requestId } = options;
        let peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.stunprotocol.org' }] });

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.warn('New ICE candidate:', event.candidate);
                ws.send(sendJsonRpcResponse(requestId, { id: sid, candidate: event.candidate, ptype: 'subscriber' }));
            }
        }

        const stream = rooms[room].find(user => user.id === pid).stream;
        stream.getTracks().forEach(track => {
            peerConnection.addTrack(track, stream);
            console.log('Track added to subscriber');
        });
        await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await peerConnection.createAnswer();

        peerConnection.setLocalDescription(answer);
        const subscriber = {
            id: sid,
            room,
            peerConnection,
            ws
        };
        subscribers.push(subscriber);
        return { room, sdp: peerConnection.localDescription };
    },
};

function sendJsonRpcResponse(id, result, error = null) {
    const response = {
        jsonrpc: "2.0",
        id: id,
        result: result || null,
        error: error || null,
    };

    return JSON.stringify(response);
}

wss.on('connection', (ws) => {
    console.log('New client connected');

    ws.on('message', async (message) => {
        console.log(`Received: ${message}`);
        try {
            const request = JSON.parse(message);

            // Validate basic JSON-RPC structure
            if (request.jsonrpc !== "2.0" || !request.method) {
                throw new Error('Invalid JSON-RPC 2.0 request');
            }

            const { id, method, params } = request;

            // Handle notifications (id is undefined)
            if (id === undefined) {
                console.log(`Notification received: ${method} with params`, params);
                return;
            }

            if (rpcMethods[method]) {
                params.ws = ws;
                params.requestId = id;
                const result = await rpcMethods[method](params);
                ws.send(sendJsonRpcResponse(id, result));
            } else {
                ws.send(sendJsonRpcResponse(id, null, { code: -32601, message: 'Method not found' }));
            }
        } catch (error) {
            console.error('Error processing message:', error);
            ws.send(sendJsonRpcResponse(null, null, { code: -32700, message: 'Parse error' }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        const disconnedtedUser = publishers.find(publisher => publisher.ws === ws);
        if (disconnedtedUser) {
            publishers = publishers.filter(publisher => publisher.ws !== ws);
            subscribers = subscribers.filter(subscriber => subscriber.ws !== ws);
            rooms[disconnedtedUser.room] = rooms[disconnedtedUser.room].filter(user => user.id !== disconnedtedUser.id);
            rooms[disconnedtedUser.room].forEach(publisher => {
                const request = {
                    jsonrpc: "2.0",
                    id: createRandomId(),
                    method: "publisherDisconnected",
                    params: {
                        id: disconnedtedUser.id
                    }
                }
                publisher.ws.send(JSON.stringify(request));
            });
            if (rooms[disconnedtedUser.room].length === 0) {
                delete rooms[disconnedtedUser.room];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});