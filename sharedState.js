const EventEmitter = require('events');

class BotState extends EventEmitter {
        constructor() {
                super();
                this.sock = null;
                this.store = null;
                this.startTime = Date.now();
                this.lidMap = new Map(); // LID JID -> PN JID (e.g. 'abc@lid' -> '234xxx@s.whatsapp.net')
                this.contactNames = new Map(); // JID -> pushName
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

        /**
         * Store a LID -> PN mapping
         * lidJid: e.g. 'abc123@lid'
         * pnJid: e.g. '2348012345678@s.whatsapp.net'
         */
        setLidMapping(lidJid, pnJid) {
                if (!lidJid || !pnJid) return;
                this.lidMap.set(lidJid, pnJid);
        }

        /**
         * Resolve any JID to a phone number string
         * Returns the phone number (e.g. '2348012345678') or null
         */
        resolvePhone(jid) {
                if (!jid) return null;

                // Already a phone number JID
                const raw = jid.split('@')[0];
                if (/^\d{7,15}$/.test(raw)) return raw;

                // Check LID map
                const pnJid = this.lidMap.get(jid);
                if (pnJid) {
                        const pn = pnJid.split('@')[0];
                        if (/^\d{7,15}$/.test(pn)) return pn;
                }

                // Also check with just the user part (in case jid has device suffix)
                const userOnly = raw.split(':')[0];
                for (const [lid, pn] of this.lidMap.entries()) {
                        if (lid.split('@')[0] === userOnly) {
                                const p = pn.split('@')[0];
                                if (/^\d{7,15}$/.test(p)) return p;
                        }
                }

                return null;
        }

        /**
         * Resolve any JID to a PN JID (for sending messages)
         * Returns '234xxx@s.whatsapp.net' or the original jid if unresolvable
         */
        resolvePnJid(jid) {
                if (!jid) return jid;

                // Already a phone number
                const raw = jid.split('@')[0];
                if (/^\d{7,15}$/.test(raw)) return jid;

                // Check LID map
                const pnJid = this.lidMap.get(jid);
                if (pnJid) return pnJid;

                // Try without device suffix
                const userOnly = raw.split(':')[0];
                for (const [lid, pn] of this.lidMap.entries()) {
                        if (lid.split('@')[0] === userOnly) return pn;
                }

                return jid; // fallback to original
        }

        /**
         * Get contact display name
         */
        setContactName(jid, name) {
                if (jid && name) this.contactNames.set(jid, name);
        }

        getContactName(jid) {
                return this.contactNames.get(jid) || null;
        }
}

module.exports = new BotState();
