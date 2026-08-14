const db = require("../config/database");

// ========================================
// GET / CREATE PRIVATE CONVERSATION
// ========================================

async function getOrCreatePrivateConversation(
    userId1,
    userId2
) {

    const [rows] = await db.execute(
        `
        SELECT c.id
        FROM conversations c

        INNER JOIN conversation_members cm1
            ON cm1.conversation_id = c.id

        INNER JOIN conversation_members cm2
            ON cm2.conversation_id = c.id

        WHERE c.type = 'private'

        AND cm1.user_id = ?

        AND cm2.user_id = ?

        LIMIT 1
        `,
        [
            userId1,
            userId2
        ]
    );

    if (rows.length > 0) {

        return rows[0].id;

    }

    // ==============================
    // CREATE CONVERSATION
    // ==============================

    const connection =
        await db.getConnection();

    try {

        await connection.beginTransaction();

        const [
            conversationResult
        ] = await connection.execute(
            `
            INSERT INTO conversations
            (type)
            VALUES ('private')
            `
        );

        const conversationId =
            conversationResult.insertId;

        // ==============================
        // MEMBER 1
        // ==============================

        await connection.execute(
            `
            INSERT INTO conversation_members
            (
                conversation_id,
                user_id
            )
            VALUES (?, ?)
            `,
            [
                conversationId,
                userId1
            ]
        );

        // ==============================
        // MEMBER 2
        // ==============================

        await connection.execute(
            `
            INSERT INTO conversation_members
            (
                conversation_id,
                user_id
            )
            VALUES (?, ?)
            `,
            [
                conversationId,
                userId2
            ]
        );

        await connection.commit();

        return conversationId;

    } catch (error) {

        await connection.rollback();

        throw error;

    } finally {

        connection.release();

    }

}

// ========================================
// SAVE MESSAGE
// ========================================

async function saveMessage({
    conversationId,
    senderId,
    message
}) {

    const [
        result
    ] = await db.execute(
        `
        INSERT INTO messages
        (
            conversation_id,
            sender_id,
            message,
            status
        )
        VALUES (?, ?, ?, 'sent')
        `,
        [
            conversationId,
            senderId,
            message
        ]
    );

    return result.insertId;

}

// ========================================
// GET MESSAGE
// ========================================

async function getMessageById(
    messageId
) {

    const [
        rows
    ] = await db.execute(
        `
        SELECT

            m.id,

            m.conversation_id,

            m.sender_id,

            u.username AS sender_username,

            m.message,

            m.status,

            m.created_at,

            m.delivered_at,

            m.read_at

        FROM messages m

        INNER JOIN users u
            ON u.id = m.sender_id

        WHERE m.id = ?

        LIMIT 1
        `,
        [
            messageId
        ]
    );

    if (rows.length === 0) {

        return null;

    }

    return rows[0];

}

// ========================================
// GET CONVERSATION
// ========================================

async function getConversation(
    userId1,
    userId2
) {

    const conversationId =
        await getOrCreatePrivateConversation(
            userId1,
            userId2
        );

    return conversationId;

}

async function getConversations(userId) {

    const [rows] = await db.execute(
        `
        SELECT

            c.id AS conversation_id,

            c.type,

            other_user.id AS other_user_id,

            other_user.username AS other_username,

            other_user.email AS other_email,

            last_message.id AS last_message_id,

            last_message.message AS last_message,

            last_message.sender_id AS last_message_sender_id,

            last_message.created_at AS last_message_at,

            COALESCE(unread.unread_count, 0)
                AS unread_count

        FROM conversations c

        INNER JOIN conversation_members my_member
            ON my_member.conversation_id = c.id

        INNER JOIN conversation_members other_member
            ON other_member.conversation_id = c.id

        INNER JOIN users other_user
            ON other_user.id = other_member.user_id

        LEFT JOIN messages last_message
            ON last_message.id = (
                SELECT m.id

                FROM messages m

                WHERE m.conversation_id = c.id

                ORDER BY m.created_at DESC,
                         m.id DESC

                LIMIT 1
            )

        LEFT JOIN (

            SELECT

                cm.conversation_id,

                COUNT(m.id) AS unread_count

            FROM conversation_members cm

            INNER JOIN messages m
                ON m.conversation_id =
                    cm.conversation_id

                AND m.id >
                    COALESCE(
                        cm.last_read_message_id,
                        0
                    )

                AND m.sender_id != cm.user_id

            GROUP BY cm.conversation_id

        ) unread

            ON unread.conversation_id =
                c.id

        WHERE my_member.user_id = ?

        AND other_member.user_id != ?

        ORDER BY
            last_message.created_at DESC,
            last_message.id DESC
        `,
        [
            userId,
            userId
        ]
    );

    return rows;
}

// ========================================
// GET HISTORY
// ========================================

async function getMessages(
    conversationId,
    userId,
    limit = 50,
    offset = 0
) {
    // ========================================
    // NORMALIZE LIMIT & OFFSET
    // ========================================

    limit = Number.parseInt(limit, 10);
    offset = Number.parseInt(offset, 10);

    // ========================================
    // DEFAULT
    // ========================================

    if (!Number.isInteger(limit) || limit <= 0) {
        limit = 50;
    }

    if (!Number.isInteger(offset) || offset < 0) {
        offset = 0;
    }

    // Maksimal 100 message per request
    if (limit > 100) {
        limit = 100;
    }

    // ========================================
    // CHECK MEMBER
    // ========================================

    const [members] = await db.execute(
        `
        SELECT id
        FROM conversation_members
        WHERE conversation_id = ?
        AND user_id = ?
        LIMIT 1
        `,
        [
            conversationId,
            userId
        ]
    );

    if (members.length === 0) {
        throw new Error(
            "User bukan member conversation"
        );
    }

    // ========================================
    // GET MESSAGES
    // ========================================

    const sql = `
        SELECT

            m.id,

            m.conversation_id,

            m.sender_id,

            u.username AS sender_username,

            m.message,

            m.status,

            m.created_at,

            m.delivered_at,

            m.read_at

        FROM messages m

        INNER JOIN users u
            ON u.id = m.sender_id

        WHERE m.conversation_id = ?

        ORDER BY m.created_at ASC

        LIMIT ${limit} OFFSET ${offset}
    `;

    const [rows] = await db.execute(
        sql,
        [
            conversationId
        ]
    );

    return rows;
}

// ========================================
// UPDATE DELIVERED
// ========================================

async function markMessageDelivered(
    messageId
) {

    await db.execute(
        `
        UPDATE messages

        SET

            status = 'delivered',

            delivered_at =
                CURRENT_TIMESTAMP

        WHERE id = ?

        AND status = 'sent'
        `,
        [
            messageId
        ]
    );

}

// ========================================
// UPDATE READ
// ========================================

async function markMessageRead(
    messageId
) {

    await db.execute(
        `
        UPDATE messages

        SET

            status = 'read',

            read_at =
                CURRENT_TIMESTAMP

        WHERE id = ?

        AND status != 'read'
        `,
        [
            messageId
        ]
    );

}

// ========================================
// Pagination Messages with Cursor
// ========================================

async function getMessagesCursor(
    conversationId,
    userId,
    beforeId = null,
    limit = 50
) {

    limit =
        Number.parseInt(
            limit,
            10
        );

    if (
        !Number.isInteger(limit) ||
        limit <= 0
    ) {

        limit = 50;

    }

    if (limit > 100) {

        limit = 100;

    }

    // ========================================
    // CHECK MEMBER
    // ========================================

    const [members] =
        await db.execute(
            `
            SELECT id

            FROM conversation_members

            WHERE conversation_id = ?

            AND user_id = ?

            LIMIT 1
            `,
            [
                conversationId,
                userId
            ]
        );

    if (
        members.length === 0
    ) {

        throw new Error(
            "User bukan member conversation"
        );

    }

    // ========================================
    // FIRST REQUEST
    // ========================================

    if (!beforeId) {

        const [rows] =
            await db.execute(
                `
                SELECT

                    m.id,

                    m.conversation_id,

                    m.sender_id,

                    u.username AS sender_username,

                    m.message,

                    m.status,

                    m.created_at,

                    m.delivered_at,

                    m.read_at

                FROM messages m

                INNER JOIN users u

                    ON u.id =
                        m.sender_id

                WHERE m.conversation_id = ?

                ORDER BY
                    m.id DESC

                LIMIT ${limit}
                `,
                [
                    conversationId
                ]
            );

        return rows.reverse();

    }

    // ========================================
    // PAGINATION
    // ========================================

    const [rows] =
        await db.execute(
            `
            SELECT

                m.id,

                m.conversation_id,

                m.sender_id,

                u.username AS sender_username,

                m.message,

                m.status,

                m.created_at,

                m.delivered_at,

                m.read_at

            FROM messages m

            INNER JOIN users u

                ON u.id =
                    m.sender_id

            WHERE m.conversation_id = ?

            AND m.id < ?

            ORDER BY
                m.id DESC

            LIMIT ${limit}
            `,
            [
                conversationId,
                beforeId
            ]
        );

    return rows.reverse();

}

// ========================================
// Read Conversation
// ========================================


async function markConversationRead(
    conversationId,
    userId,
    messageId
) {

    // ========================================
    // VERIFY MEMBER
    // ========================================

    const [
        members
    ] = await db.execute(
        `
        SELECT id

        FROM conversation_members

        WHERE conversation_id = ?

        AND user_id = ?

        LIMIT 1
        `,
        [
            conversationId,
            userId
        ]
    );

    if (
        members.length === 0
    ) {

        throw new Error(
            "User bukan member conversation"
        );

    }

    // ========================================
    // UPDATE
    // ========================================

    await db.execute(
        `
        UPDATE conversation_members

        SET last_read_message_id = ?

        WHERE conversation_id = ?

        AND user_id = ?
        `,
        [
            messageId,
            conversationId,
            userId
        ]
    );

    // ========================================
    // UPDATE MESSAGE
    // ========================================

    await db.execute(
        `
        UPDATE messages

        SET
            status = 'read',
            read_at = CURRENT_TIMESTAMP

        WHERE conversation_id = ?

        AND id <= ?

        AND sender_id != ?

        AND status != 'read'
        `,
        [
            conversationId,
            messageId,
            userId
        ]
    );

}

module.exports = {

    getOrCreatePrivateConversation,

    getConversation,

    saveMessage,

    getMessageById,

    getMessages,

    getMessagesCursor,

    markMessageDelivered,

    markConversationRead,

    markMessageRead,

    getConversations,

};