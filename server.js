require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();

const PORT = process.env.PORT || 3000;

// Security, logging, and performance middlewares
// Disable CSP for now since we load multiple external scripts from CDNs (Tailwind, ChartJS, Firebase)
app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(morgan('combined'));
app.use(compression());

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: { error: 'Too many requests from this IP, please try again later.' }
});
app.use('/api/', limiter);

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Firebase Admin correctly with Application Default Credentials
// For production, you would set GOOGLE_APPLICATION_CREDENTIALS environment variable.
const admin = require('firebase-admin');
try {
    if (!admin.apps.length) {
         // This works when running in GCP or when GOOGLE_APPLICATION_CREDENTIALS is set
         admin.initializeApp({
             projectId: 'booksdev-3de79', // Required when credentials aren't explicit
         });
    }
} catch (error) {
    console.error("Firebase admin init failed", error);
}

// Middleware to verify Firebase ID Token securely
const verifyAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    const idToken = authHeader.split('Bearer ')[1];

    // For sandbox testing via playwright (which generates a dummy token like 'header.eyJ1c2VyX2lkIjoidGVzdF91aWRfcHJvIiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIn0=.signature')
    if (process.env.NODE_ENV !== 'production' && idToken.startsWith('header.')) {
        try {
            const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
            req.user = { uid: payload.user_id, email: payload.email };
            return next();
        } catch (e) {
             return res.status(401).json({ error: 'Unauthorized: Invalid mock token' });
        }
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error("Token verification failed", error);
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};

// Friendly URL routing
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/contact', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'contact.html'));
});

// API Endpoints
app.post('/api/auth', verifyAuth, (req, res) => {
    const { email, displayName } = req.body;
    const uid = req.user.uid;

    if (!uid || !email) {
        return res.status(400).json({ error: 'UID and email are required' });
    }

    db.get('SELECT * FROM users WHERE id = ?', [uid], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            db.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', [uid, email, displayName], function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                res.json({ message: 'User created successfully', is_pro: false });
            });
        } else {
            res.json({ message: 'User already exists', is_pro: Boolean(row.is_pro) });
        }
    });
});

app.get('/api/user/:uid', verifyAuth, (req, res) => {
    // Ensure the user is requesting their own data
    if (req.params.uid !== req.user.uid) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const uid = req.user.uid;
    db.get('SELECT * FROM users WHERE id = ?', [uid], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user: row });
    });
});

app.post('/api/download', verifyAuth, (req, res) => {
    const uid = req.user.uid;
    db.run('UPDATE users SET downloads_this_month = downloads_this_month + 1 WHERE id = ?', [uid], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        return res.json({ success: true, message: 'Download started' });
    });
});

app.post('/api/contact', verifyAuth, (req, res) => {
    const { message } = req.body;
    const uid = req.user.uid;

    db.run('UPDATE users SET messages_this_month = messages_this_month + 1 WHERE id = ?', [uid], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        return res.json({ success: true, message: 'Message sent successfully' });
    });
});

app.delete('/api/user/:uid', verifyAuth, (req, res) => {
    if (req.params.uid !== req.user.uid) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    const uid = req.user.uid;
    db.run('DELETE FROM users WHERE id = ?', [uid], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        return res.json({ success: true, message: 'Account deleted successfully' });
    });
});

// 404 Route (Express 5 compatibility)
app.use((req, res, next) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Centralized error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
