require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");

const authRoutes =
    require("./routes/authRoutes");

const {
    initializeWebSocket,
} = require("./websocket/websocketServer");

const app = express();

const server =
    http.createServer(app);

// ========================================
// MIDDLEWARE
// ========================================

app.use(
    express.json()
);

app.use(
    express.urlencoded({
        extended: true,
    })
);

// ========================================
// STATIC
// ========================================

app.use(
    express.static(
        path.join(
            __dirname,
            "..",
            "public"
        )
    )
);

// ========================================
// API
// ========================================

app.get(
    "/api",
    (req, res) => {

        res.json({

            success: true,

            message:
                "WebSocket Chat API",

        });

    }
);

app.use(
    "/api/auth",
    authRoutes
);

// ========================================
// WEBSOCKET
// ========================================

initializeWebSocket(
    server
);

// ========================================
// START
// ========================================

const PORT =
    process.env.PORT ||
    8080;

server.listen(
    PORT,
    () => {

        console.log(`
============================================

WebSocket Chat Server

HTTP:
http://localhost:${PORT}

API:
http://localhost:${PORT}/api

WebSocket:
ws://localhost:${PORT}/ws

============================================
        `);

    }
);