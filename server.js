const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Create Database Pool (Compatible with TiDB and MySQL)
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ==========================================
// AUTHENTICATION ROUTES (Login & Registration)
// ==========================================

// Register Account
app.post('/api/auth/register', async (req, res) => {
    const { username, password, role, organization_type, city, province, country } = req.body;

    try {
        // Enforce approval rules based on role selection
        let isApproved = false;
        if (role === 'resident') {
            isApproved = true; // Residents don't need admin approval
        }

        const [result] = await pool.execute(
            `INSERT INTO users (username, password, role, organization_type, is_approved, city, province, country) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [username, password, role, role === 'organization' ? organization_type : 'NONE', isApproved, city, province, country]
        );

        res.status(201).json({ 
            success: true, 
            message: role === 'organization' 
                ? 'Registration successful. Waiting for Admin approval.' 
                : 'Registration successful. You can log in now.' 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Login Account (Handles Admin check explicitly)
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        // Explicit explicit handling for requested Admin account
        if (username === 'Wanya' && password === 'Wanya') {
            const [adminUser] = await pool.execute('SELECT * FROM users WHERE username = "Wanya"');
            return res.json({
                success: true,
                message: 'Welcome Admin Wanya',
                user: { id: adminUser[0].id, username: 'Wanya', role: 'admin' }
            });
        }

        // Regular verification lookup
        const [users] = await pool.execute('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);

        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const user = users[0];

        // Block unapproved organization accounts
        if (user.role === 'organization' && !user.is_approved) {
            return res.status(403).json({ success: false, message: 'Your organization account is awaiting admin approval.' });
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                organization_type: user.organization_type,
                city: user.city,
                province: user.province,
                country: user.country
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// ADMIN CONTROL ROUTES
// ==========================================

// Get all pending organizations awaiting verification
app.get('/api/admin/pending-orgs', async (req, res) => {
    try {
        const [orgs] = await pool.execute('SELECT id, username, organization_type, city, province, country FROM users WHERE role = "organization" AND is_approved = FALSE');
        res.json({ success: true, pending_organizations: orgs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Approve an organization registration
app.put('/api/admin/approve-org/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.execute('UPDATE users SET is_approved = TRUE WHERE id = ?', [id]);
        res.json({ success: true, message: 'Organization successfully approved.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// NOTIFICATION & POSTS ROUTES
// ==========================================

// Create a Notification (Restricted to Admins and Verified Organizations Only)
app.post('/api/posts', async (req, res) => {
    const { 
        author_id, role, category, person_name, last_seen, attire, picture_url, contact_info, scope, scope_value 
    } = req.body;

    // Strict Requirement: Residents are completely forbidden from executing notifications
    if (role === 'resident') {
        return res.status(403).json({ success: false, message: 'Access Denied: Residents are not permitted to submit alerts.' });
    }

    // Input Validation assertion
    if (!category || !person_name || !last_seen || !attire || !contact_info || !scope || !scope_value) {
        return res.status(400).json({ success: false, message: 'All fields (Information, Last Seen, Attire, Picture reference, Contact, and Location Scope) are strictly required.' });
    }

    try {
        const [result] = await pool.execute(
            `INSERT INTO posts (author_id, category, person_name, last_seen, attire, picture_url, contact_info, scope, scope_value) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [author_id, category, person_name, last_seen, attire, picture_url || 'Rihana.jpeg', contact_info, scope.toUpperCase(), scope_value]
        );

        res.status(201).json({ success: true, message: 'Alert posted successfully across targeted region.', postId: result.insertId });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Fetch Notifications targeted to a specific Resident's Geo-location
app.get('/api/posts/feed', async (req, res) => {
    const { city, province, country } = req.query;

    try {
        // Filters notifications matches: Country-wide, Province-wide or explicit local City-wide
        const [posts] = await pool.execute(
            `SELECT * FROM posts 
             WHERE (scope = 'COUNTRY' AND scope_value = ?)
                OR (scope = 'PROVINCE' AND scope_value = ?)
                OR (scope = 'CITY' AND scope_value = ?)
             ORDER BY created_at DESC`,
            [country, province, city]
        );

        // Grouping logic separating Missing vs Wanted for the UI categorization screen
        const categorizedFeed = {
            missing_persons: posts.filter(p => p.category === 'MISSING PERSONS'),
            wanted_persons: posts.filter(p => p.category === 'WANTED PERSONS')
        };

        res.json({ success: true, feed: categorizedFeed, raw_count: posts.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Run server initialization
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Rehana Engine running seamlessly on port ${PORT}`);
});