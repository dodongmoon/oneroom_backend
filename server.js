require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Server is running successfully!');
});

// Temporary Seed Route for Building A
app.get('/seed-a', async (req, res) => {
    try {
        const query = `
      INSERT INTO rooms (building_name, floor, room_number, status) VALUES
      ('A', 4, '401', 'ready'), ('A', 4, '402', 'ready'), ('A', 4, '403', 'ready'), ('A', 4, '404', 'ready'),
      ('A', 3, '301', 'ready'), ('A', 3, '302', 'ready'), ('A', 3, '303', 'ready'), ('A', 3, '304', 'ready'), ('A', 3, '305', 'ready'),
      ('A', 2, '201', 'ready'), ('A', 2, '202', 'ready'), ('A', 2, '203', 'ready'), ('A', 2, '204', 'ready'), ('A', 2, '205', 'ready')
      ON CONFLICT (building_name, room_number) DO NOTHING;
    `;
        await pool.query(query);
        res.send('Building A Created! (14 rooms added)');
    } catch (err) {
        res.status(500).send('Error: ' + err.message);
    }
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for simplicity (or configure specifically for Vercel app)
        methods: ["GET", "POST"]
    }
});

// Database Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Create Table if not exists
const initDb = async () => {
    try {
        await pool.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id SERIAL PRIMARY KEY,
        building_name TEXT NOT NULL,
        room_number TEXT NOT NULL,
        floor INT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ready',
        memo TEXT DEFAULT '',
        UNIQUE(building_name, room_number)
      );
    `);

        // Add memo column if it doesn't exist
        await pool.query(`
            ALTER TABLE rooms ADD COLUMN IF NOT EXISTS memo TEXT DEFAULT '';
        `);

        // Add is_deposit_paid column if it doesn't exist (migration)
        await pool.query(`
            ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_deposit_paid BOOLEAN DEFAULT FALSE;
        `);

        // Seed Check - simple check if empty
        const { rows } = await pool.query('SELECT COUNT(*) FROM rooms');
        if (parseInt(rows[0].count) === 0) {
            console.log("Seeding Database...");
            // Seed data logic
            const rooms = [];
            // Building B seed
            for (let f = 2; f <= 4; f++) {
                for (let r = 1; r <= 6; r++) rooms.push(`('B', ${f}, '${f}0${r}', 'ready', '', false)`);
            }
            // Building C seed
            for (let f = 2; f <= 4; f++) {
                for (let r = 1; r <= 5; r++) rooms.push(`('C', ${f}, '${f}0${r}', 'ready', '', false)`);
            }

            const query = `INSERT INTO rooms (building_name, floor, room_number, status, memo, is_deposit_paid) VALUES ${rooms.join(',')}`;
            await pool.query(query);
            console.log("Database Seeded!");
        }
    } catch (err) {
        console.error("Error initializing DB:", err);
    }
};

initDb();

// Socket.io Logic
io.on('connection', async (socket) => {
    console.log('User connected:', socket.id);

    // Send initial data
    try {
        const result = await pool.query('SELECT * FROM rooms ORDER BY room_number ASC');
        socket.emit('initial_data', result.rows);
    } catch (err) {
        console.error(err);
    }

    // Handle Updates
    socket.on('update_room', async ({ id, status, memo, is_deposit_paid }) => {
        try {
            const updates = [];
            const values = [];
            let idx = 1;

            if (status !== undefined) {
                updates.push(`status = $${idx++}`);
                values.push(status);
            }
            if (memo !== undefined) {
                updates.push(`memo = $${idx++}`);
                values.push(memo);
            }
            if (is_deposit_paid !== undefined) {
                updates.push(`is_deposit_paid = $${idx++}`);
                values.push(is_deposit_paid);
            }

            if (updates.length === 0) return;

            values.push(id);
            const query = `UPDATE rooms SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;

            const result = await pool.query(query, values);

            if (result.rows.length > 0) {
                // Broadcast to everyone (including sender)
                io.emit('room_updated', result.rows[0]);
            }
        } catch (err) {
            console.error("Update error:", err);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
