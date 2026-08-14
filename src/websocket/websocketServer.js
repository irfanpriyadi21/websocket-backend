const {
    getOrCreatePrivateConversation,
    saveMessage,
    getMessageById,
    getMessages,
    getMessagesCursor,
    markMessageDelivered,
    markConversationRead,
    getConversations
} = require("../services/chatServices");
const jwt = require("jsonwebtoken");
const WebSocket = require("ws");

// ========================================
// ONLINE USERS
// ========================================

const connections =
    new Map();

/*
connections:

userId => Set(socket)

Contoh:

1 => [socket1, socket2]
2 => [socket3]
*/

// ========================================
// SEND
// ========================================

function send(
    socket,
    data
) {

    if (
        socket.readyState ===
        WebSocket.OPEN
    ) {

        socket.send(
            JSON.stringify(data)
        );

    }

}

// ========================================
// BROADCAST ONLINE USERS
// ========================================

function broadcastOnlineUsers() {

    const onlineUsers =
        Array.from(
            connections.keys()
        ).map(
            (userId) =>
                String(userId)
        );

    connections.forEach(
        (sockets) => {

            sockets.forEach(
                (socket) => {

                    send(
                        socket,
                        {

                            type:
                                "online_users",

                            users:
                                onlineUsers,

                        }
                    );

                }
            );

        }
    );

}

// ========================================
// ADD CONNECTION
// ========================================

function addConnection(
    userId,
    socket
) {

    if (
        !connections.has(
            userId
        )
    ) {

        connections.set(
            userId,
            new Set()
        );

    }

    connections
        .get(userId)
        .add(socket);

}

// ========================================
// REMOVE CONNECTION
// ========================================

function removeConnection(
    userId,
    socket
) {

    const sockets =
        connections.get(
            userId
        );

    if (!sockets) {
        return;
    }

    sockets.delete(socket);

    if (
        sockets.size === 0
    ) {

        connections.delete(
            userId
        );

    }

}

// ========================================
// SEND TO USER
// ========================================

function sendToUser(
    userId,
    data
) {

    const sockets =
        connections.get(
            String(userId)
        );

    if (!sockets) {

        return false;

    }

    sockets.forEach(
        (socket) => {

            send(
                socket,
                data
            );

        }
    );

    return true;

}

// ========================================
// AUTHENTICATE
// ========================================

function authenticateSocket(
    token
) {

    try {

        return jwt.verify(
            token,
            process.env.JWT_SECRET
        );

    } catch (error) {

        return null;

    }

}

// ========================================
// INITIALIZE
// ========================================

function initializeWebSocket(
    server
) {

    const wss =
        new WebSocket.Server({
            server,
            path: "/ws",
        });

    wss.on(
        "connection",
        (
            socket,
            request
        ) => {

            console.log(
                "WebSocket connected"
            );

            // ============================
            // GET TOKEN
            // ============================

            const url =
                new URL(
                    request.url,
                    `http://${request.headers.host}`
                );

            const token =
                url.searchParams.get(
                    "token"
                );

            if (!token) {

                send(socket, {

                    type:
                        "auth_error",

                    message:
                        "Token diperlukan",

                });

                socket.close();

                return;

            }

            // ============================
            // VERIFY JWT
            // ============================

            const user =
                authenticateSocket(
                    token
                );

            if (!user) {

                send(socket, {

                    type:
                        "auth_error",

                    message:
                        "Token tidak valid",

                });

                socket.close();

                return;

            }

            const userId =
                String(
                    user.userId
                );

            // ============================
            // SAVE CONNECTION
            // ============================

            socket.user = user;

            addConnection(
                userId,
                socket
            );

            console.log(
                `User ${user.username} online`
            );

            send(socket, {

                type:
                    "authenticated",

                user: {

                    userId,

                    username:
                        user.username,

                    email:
                        user.email,

                },

            });

            broadcastOnlineUsers();

            // ============================
            // MESSAGE
            // ============================

            socket.on(
                "message",
                async (rawMessage) => {

                    try {

                        const data =
                            JSON.parse(
                                rawMessage.toString()
                            );

                        await handleMessage(
                            socket,
                            data
                        );

                    } catch (error) {

                        console.error(
                            "WebSocket message error:",
                            error
                        );

                        send(socket, {

                            type:
                                "error",

                            message:
                                "Server error"

                        });

                    }

                }
            );

            // ============================
            // CLOSE
            // ============================

            socket.on(
                "close",
                () => {

                    removeConnection(
                        userId,
                        socket
                    );

                    console.log(
                        `User ${user.username} offline`
                    );

                    broadcastOnlineUsers();

                }
            );

        }
    );

    console.log(
        "WebSocket initialized: /ws"
    );

    return wss;

}

// ========================================
// MESSAGE HANDLER
// ========================================
async function handleMessage(
    socket,
    data
) {

    const user =
        socket.user;

    // ====================================
    // PRIVATE MESSAGE
    // ====================================

    if (
        data.type ===
        "private_message"
    ) {

        const targetUserId =
            String(
                data.toUserId
            );

        const message =
            String(
                data.message || ""
            ).trim();

        if (!message) {

            send(socket, {

                type:
                    "error",

                message:
                    "Message tidak boleh kosong"

            });

            return;

        }

        if (
            targetUserId ===
            String(user.userId)
        ) {

            send(socket, {

                type:
                    "error",

                message:
                    "Tidak bisa mengirim pesan ke diri sendiri"

            });

            return;

        }

        // =================================
        // CREATE / GET CONVERSATION
        // =================================

        const conversationId =
            await getOrCreatePrivateConversation(

                String(user.userId),

                targetUserId

            );

        // =================================
        // SAVE MESSAGE
        // =================================

        const messageId =
            await saveMessage({

                conversationId,

                senderId:
                    String(
                        user.userId
                    ),

                message

            });

        // =================================
        // GET MESSAGE
        // =================================

        const savedMessage =
            await getMessageById(
                messageId
            );

        const messageData = {

            type:
                "private_message",

            messageId:
                String(
                    savedMessage.id
                ),

            conversationId:
                String(
                    savedMessage.conversation_id
                ),

            fromUserId:
                String(
                    savedMessage.sender_id
                ),

            fromUsername:
                savedMessage.sender_username,

            toUserId:
                targetUserId,

            message:
                savedMessage.message,

            status:
                savedMessage.status,

            timestamp:
                savedMessage.created_at

        };

        // =================================
        // SEND RECEIVER
        // =================================

        const sent =
            sendToUser(
                targetUserId,
                messageData
            );

        // =================================
        // SEND SENDER
        // =================================

        send(
            socket,
            messageData
        );

        // =================================
        // DELIVERED
        // =================================

        if (sent) {

            await markMessageDelivered(
                messageId
            );

            const deliveredData = {

                type:
                    "message_delivered",

                messageId:
                    String(
                        messageId
                    ),

                conversationId:
                    String(
                        conversationId
                    ),

                deliveredAt:
                    new Date()
                        .toISOString()

            };

            send(
                socket,
                deliveredData
            );

        }

        // =================================
        // OFFLINE
        // =================================

        if (!sent) {

            send(socket, {

                type:
                    "user_offline",

                userId:
                    targetUserId,

                messageId:
                    String(
                        messageId
                    )

            });

        }

        return;

    }

     // ====================================
    // Get Conversations
    // ====================================
    if (
        data.type ===
        "get_conversations"
    ) {

        try {

            const conversations =
                await getConversations(
                    String(user.userId)
                );

            send(socket, {

                type:
                    "conversations",

                conversations

            });

        } catch (error) {

            console.error(
                "Get conversations error:",
                error
            );

            send(socket, {

                type:
                    "error",

                message:
                    error.message

            });

        }

        return;
    }

    // ====================================
    // GET HISTORY
    // ====================================

    if (
        data.type ===
        "get_history"
    ) {

        const targetUserId =
            String(data.userId);

        try {

            const conversationId =
                await getOrCreatePrivateConversation(
                    String(user.userId),
                    targetUserId
                );

            const messages =
                await getMessagesCursor(

                    conversationId,

                    String(
                        user.userId
                    ),

                    data.beforeId || null,

                    data.limit || 50

                );

            const hasMore =
                messages.length ===
                Number(
                    data.limit || 50
                );

            send(socket, {

                type:
                    "history",

                conversationId:
                    String(
                        conversationId
                    ),

                userId:
                    targetUserId,

                messages,

                hasMore,

                nextBeforeId:
                    messages.length > 0
                        ? messages[0].id
                        : null

            });

        } catch (error) {

            console.error(
                "Get history error:",
                error
            );

            send(socket, {

                type:
                    "error",

                message:
                    error.message

            });

        }

        return;
    }

    // ====================================
    // READ MESSAGE
    // ====================================

    if (
        data.type ===
        "read_message"
    ) {

        const messageId =
            data.messageId;

        const fromUserId =
            String(
                data.fromUserId
            );

        try {

            await markMessageRead(
                messageId
            );

            sendToUser(
                fromUserId,
                {

                    type:
                        "message_read",

                    messageId:
                        String(
                            messageId
                        ),

                    readBy:
                        String(
                            user.userId
                        ),

                    readAt:
                        new Date()
                            .toISOString()

                }
            );

        } catch (error) {

            console.error(
                "Read error:",
                error
            );

        }

        return;

    }

    // ====================================
    // TYPING
    // ====================================

    if (
        data.type ===
        "typing"
    ) {

        const targetUserId =
            String(
                data.toUserId
            );

        sendToUser(
            targetUserId,
            {

                type:
                    "typing",

                userId:
                    String(
                        user.userId
                    ),

                username:
                    user.username,

                isTyping:
                    Boolean(
                        data.isTyping
                    )

            }
        );

        return;

    }

    // ====================================
    // Mark Conversation Read
    // ====================================

    if (
        data.type ===
        "mark_conversation_read"
    ) {

        try {

            await markConversationRead(

                String(
                    data.conversationId
                ),

                String(
                    user.userId
                ),

                String(
                    data.messageId
                )

            );

            send(socket, {

                type:
                    "conversation_read",

                conversationId:
                    String(
                        data.conversationId
                    ),

                messageId:
                    String(
                        data.messageId
                    )

            });

        } catch (error) {

            console.error(
                "Mark conversation read error:",
                error
            );

            send(socket, {

                type:
                    "error",

                message:
                    error.message

            });

        }

        return;
    }

    // ====================================
    // UNKNOWN
    // ====================================

    send(socket, {

        type:
            "error",

        message:
            "Unknown message type"

    });

}

module.exports = {
    initializeWebSocket,
};