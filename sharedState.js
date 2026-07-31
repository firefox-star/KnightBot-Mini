const EventEmitter = require('events');

class BotState extends EventEmitter {
        constructor() {
                super();
                this.sock = null;
                this.store = null;
                this.startTime = Date.now();
        }

        setSock(sock) {
                this.sock = sock;
                this.emit('connected');
        }

        getSock() {
                return this.sock;
        }

        setStore(store) {
                this.store = store;
        }

        getStore() {
                return this.store;
        }
}

module.exports = new BotState();
