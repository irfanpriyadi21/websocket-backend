const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const db = require("../config/database");

// ========================================
// REGISTER
// ========================================

async function register(req, res) {

    try {

        const {
            username,
            email,
            password,
        } = req.body;

        // Validation

        if (
            !username ||
            !email ||
            !password
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Username, email dan password wajib diisi",

            });

        }

        if (password.length < 6) {

            return res.status(400).json({

                success: false,

                message:
                    "Password minimal 6 karakter",

            });

        }

        // Check user

        const [existingUsers] =
            await db.execute(
                `
                SELECT id
                FROM users
                WHERE username = ?
                   OR email = ?
                LIMIT 1
                `,
                [
                    username,
                    email,
                ]
            );

        if (
            existingUsers.length > 0
        ) {

            return res.status(409).json({

                success: false,

                message:
                    "Username atau email sudah digunakan",

            });

        }

        // Hash password

        const hashedPassword =
            await bcrypt.hash(
                password,
                10
            );

        // Insert

        const [result] =
            await db.execute(
                `
                INSERT INTO users
                (
                    username,
                    email,
                    password
                )
                VALUES (?, ?, ?)
                `,
                [
                    username,
                    email,
                    hashedPassword,
                ]
            );

        return res.status(201).json({

            success: true,

            message:
                "Register berhasil",

            data: {

                id: result.insertId,

                username,

                email,

            },

        });

    } catch (error) {

        console.error(
            "Register error:",
            error
        );

        return res.status(500).json({

            success: false,

            message:
                "Internal server error",

        });

    }

}


// ========================================
// LOGIN
// ========================================

async function login(req, res) {

    try {

        const {
            email,
            password,
        } = req.body;

        if (
            !email ||
            !password
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Email dan password wajib diisi",

            });

        }

        // Find user

        const [users] =
            await db.execute(
                `
                SELECT
                    id,
                    username,
                    email,
                    password
                FROM users
                WHERE email = ?
                LIMIT 1
                `,
                [email]
            );

        if (
            users.length === 0
        ) {

            return res.status(401).json({

                success: false,

                message:
                    "Email atau password salah",

            });

        }

        const user = users[0];

        // Check password

        const validPassword =
            await bcrypt.compare(
                password,
                user.password
            );

        if (!validPassword) {

            return res.status(401).json({

                success: false,

                message:
                    "Email atau password salah",

            });

        }

        // Create JWT

        const token =
            jwt.sign(

                {
                    userId:
                        user.id,

                    username:
                        user.username,

                    email:
                        user.email,
                },

                process.env.JWT_SECRET,

                {
                    expiresIn:
                        process.env.JWT_EXPIRES_IN ||
                        "7d",
                }

            );

        return res.json({

            success: true,

            message:
                "Login berhasil",

            data: {

                token,

                user: {

                    id:
                        user.id,

                    username:
                        user.username,

                    email:
                        user.email,

                },

            },

        });

    } catch (error) {

        console.error(
            "Login error:",
            error
        );

        return res.status(500).json({

            success: false,

            message:
                "Internal server error",

        });

    }

}


module.exports = {

    register,

    login,

};