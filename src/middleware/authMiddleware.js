const jwt = require("jsonwebtoken");

function authenticateToken(
    req,
    res,
    next
) {

    const authHeader =
        req.headers.authorization;

    if (!authHeader) {

        return res.status(401).json({

            success: false,

            message:
                "Authorization token diperlukan",

        });

    }

    const [
        type,
        token,
    ] = authHeader.split(" ");

    if (
        type !== "Bearer" ||
        !token
    ) {

        return res.status(401).json({

            success: false,

            message:
                "Format token tidak valid",

        });

    }

    try {

        const decoded =
            jwt.verify(
                token,
                process.env.JWT_SECRET
            );

        req.user = decoded;

        next();

    } catch (error) {

        return res.status(401).json({

            success: false,

            message:
                "Token tidak valid atau sudah expired",

        });

    }

}

module.exports =
    authenticateToken;