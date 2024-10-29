import SocketClient from "../lib/socket-client.js";
const localVideo = document.getElementById('local-video');
const startSessionButton = document.getElementById('startSessionButton');
let url = new URL(window.location.href);
let peerConnection;
let room = url.searchParams.get('room');
let publisherId;
let subscribers = [];

const socketClient = new SocketClient({
    onMessage: onMessage
});

function onMessage(response) {
    console.log('onMessage:', response);
    if(response.method === "newPublisher") {
        subscribe(response.params.id);
    }
    if(response.method === "publisherDisconnected") {
        const remoteVideo = document.getElementById(`remote-video-${response.params.id}`);
        if(remoteVideo) {
            remoteVideo.remove();
        }
    }
}

async function init() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = stream;

        peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.stunprotocol.org' }] });

        stream.getTracks().forEach(track => {
            peerConnection.addTrack(track, stream);
        });

        console.log('PeerConnection created and media stream added.');

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.warn('New ICE candidate:', event.candidate);
                socketClient.call('candidate', { id: publisherId, candidate: event.candidate, ptype: 'publisher' });
            }
        };

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        console.log('Local offer set.');

        socketClient.call('publish', { sdp: peerConnection.localDescription, room }, async (response) => {
            console.log('Publish response:', response);
            const result = response.result;
            if (result.candidate) {
                await peerConnection.addIceCandidate(result.candidate);
            } else {
                publisherId = result.id;
                await peerConnection.setRemoteDescription(new RTCSessionDescription(result.sdp));
                result.usersInRoom.forEach((userId) => {
                    subscribe(userId);
                });
            }
        });
    } catch (error) {
        console.error('Error accessing media devices.', error);
    }
}

async function subscribe(userId) {
    const subscriberId = socketClient.randomId;
    let subscriberPC = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.stunprotocol.org' }] });
    subscriberPC.addTransceiver('video', { direction: 'recvonly' });
    subscriberPC.addTransceiver('audio', { direction: 'recvonly' });
    console.log('Subscriber PeerConnection created.');
    subscriberPC.ontrack = (event) => {
        console.log(`New track for subscriber ${userId}`);
        const stream = event.streams[0];
        stream.onremovetrack = () => {
            console.log(`Track removed for subscriber ${userId}`);
        };
        let remoteVideo = document.getElementById(`remote-video-${userId}`);
        if (!remoteVideo) {
            remoteVideo = document.createElement('video');
            remoteVideo.id = `remote-video-${userId}`;
            remoteVideo.width = 240;
            remoteVideo.height = 180;
            remoteVideo.controls = true;
            remoteVideo.autoplay = true;
            remoteVideo.srcObject = stream;
            document.body.appendChild(remoteVideo);
        } else {
            remoteVideo.srcObject = stream;
        }
    };

    subscriberPC.onicecandidate = (event) => {
        if (event.candidate) {
            console.warn('New ICE candidate:', event.candidate);
            socketClient.call('candidate', { id: subscriberId, candidate: event.candidate, ptype: 'subscriber' });
        }
    }

    const offer = await subscriberPC.createOffer();
    await subscriberPC.setLocalDescription(offer);
    console.log('Local offer set for subscriber.');
    socketClient.call('subscribe', { pid: userId, sid: subscriberId, sdp: subscriberPC.localDescription, room }, async (response) => {
        console.log('Subscribe response:', response);
        const result = response.result;
        if (result.candidate) {
            await subscriberPC.addIceCandidate(result.candidate);
        } else {
            await subscriberPC.setRemoteDescription(new RTCSessionDescription(result.sdp));
            subscribers.push({ id: subscriberId, peerConnection: subscriberPC });
            console.log('Remote description set for subscriber.');
        }
    });
}

startSessionButton.addEventListener('click', init);