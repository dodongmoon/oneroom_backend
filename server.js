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
      ('A', 4, '401', 'vacant'), ('A', 4, '402', 'vacant'), ('A', 4, '403', 'vacant'), ('A', 4, '404', 'vacant'),
      ('A', 3, '301', 'vacant'), ('A', 3, '302', 'vacant'), ('A', 3, '303', 'vacant'), ('A', 3, '304', 'vacant'), ('A', 3, '305', 'vacant'),
      ('A', 2, '201', 'vacant'), ('A', 2, '202', 'vacant'), ('A', 2, '203', 'vacant'), ('A', 2, '204', 'vacant'), ('A', 2, '205', 'vacant')
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
        status TEXT NOT NULL DEFAULT 'vacant',
        memo TEXT DEFAULT '',
        UNIQUE(building_name, room_number)
      );
    `);

        // Add memo column if it doesn't exist (migration for existing DB)
        await pool.query(`
            ALTER TABLE rooms ADD COLUMN IF NOT EXISTS memo TEXT DEFAULT '';
        `);

        // Seed Check - simple check if empty
        const { rows } = await pool.query('SELECT COUNT(*) FROM rooms');
        if (parseInt(rows[0].count) === 0) {
            console.log("Seeding Database...");
            // Seed data logic
            const rooms = [];
            // Building B seed
            for (let f = 2; f <= 4; f++) {
                for (let r = 1; r <= 6; r++) rooms.push(`('B', ${f}, '${f}0${r}', 'vacant', '')`);
            }
            // Building C seed
            for (let f = 2; f <= 4; f++) {
                for (let r = 1; r <= 5; r++) rooms.push(`('C', ${f}, '${f}0${r}', 'vacant', '')`);
            }

            const query = `INSERT INTO rooms (building_name, floor, room_number, status, memo) VALUES ${rooms.join(',')}`;
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
    // Handle Updates
    socket.on('update_room', async ({ id, status, memo }) => {
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
