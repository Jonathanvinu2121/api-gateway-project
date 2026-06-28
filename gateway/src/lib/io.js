const { Server } = require('socket.io');

let ioInstance = null;

function init(server) {
  ioInstance = new Server(server, {
    cors: {
      origin: '*', // Allow all origins for dashboard integration
      methods: ['GET', 'POST']
    }
  });

  ioInstance.on('connection', (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  });

  return ioInstance;
}

function getIo() {
  return ioInstance;
}

function emitEvent(event, payload) {
  if (ioInstance) {
    ioInstance.emit(event, payload);
  } else {
    console.warn(`[Socket.io] Warning: Attempted to emit event '${event}' but socket server is not initialized.`);
  }
}

module.exports = {
  init,
  getIo,
  emitEvent
};
