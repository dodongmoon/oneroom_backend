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
        UNIQUE(building_name, room_number)
      );
    `);

        // Seed Check - simple check if empty
        const { rows } = await pool.query('SELECT COUNT(*) FROM rooms');
        if (parseInt(rows[0].count) === 0) {
            console.log("Seeding Database...");
            // Seed data logic
            const rooms = [];
            // Building B seed
            for (let f = 2; f <= 4; f++) {
                for (let r = 1; r <= 6; r++) rooms.push(`('B', ${f}, '${f}0${r}', 'vacant')`);
            }
            // Building C seed
            for (let f = 2; f <= 4; f++) {
                for (let r = 1; r <= 5; r++) rooms.push(`('C', ${f}, '${f}0${r}', 'vacant')`);
            }

            const query = `INSERT INTO rooms (building_name, floor, room_number, status) VALUES ${rooms.join(',')}`;
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
    socket.on('update_room', async ({ id, status }) => {
        try {
            // Update DB
            const result = await pool.query(
                'UPDATE rooms SET status = $1 WHERE id = $2 RETURNING *',
                [status, id]
            );

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
