const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');

        db.run(`CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            name TEXT,
            is_pro BOOLEAN DEFAULT 0,
            downloads_this_month INTEGER DEFAULT 0,
            messages_this_month INTEGER DEFAULT 0
        )`, (err) => {
            if (err) {
                console.error('Error creating users table', err.message);
            }
        });
    }
});

module.exports = db;
