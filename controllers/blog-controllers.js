const { validationResult } = require('express-validator');

const db = require('../queries');


const getBlogs = async (req, res, next) => {
    let blogs;
    try {
        blogs = await db.query('SELECT * FROM blogs');
        blogs = blogs.rows;
    } catch (e) {
        return res.status(500).json({
            status: 'error',
            message: 'Failed to get blogs'
        })
    }

    res.json({
        blogs:
            blogs.map(blog => blog)
    });
};

const getBlogById = async (req, res, next) => {
    const blogId = req.params.bid;

    let blog;
    try {
        blog = await db.query("SELECT * FROM blogs WHERE b_id = $1", [blogId]);
        blog = blog.rows[0]
    } catch (e) {
        return res.status(500).json({
            status: 'error',
            message: 'Failed to get blog'
        })
    }

    res.json( {blog: blog} )
};

const getBlogsByUserId = async (req, res, next) => {
    const userId = req.params.uid;

    let userWithBlogs;
    try {
        userWithBlogs = await db.query('SELECT * FROM blogs WHERE author = $1', [userId]);
        userWithBlogs = userWithBlogs.rows;
    } catch (e) {
        return res.status(500).json({
            status: 'error',
            message: 'Failed to get blog by user id'
        })
    }

    res.json({ blogs: userWithBlogs.map(blog =>
            blog
        )
    })
};

const createBlog = async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(401).json({
            status: 'error',
            message: 'Invalid input please try again.'
        })
    }
    const { title, authorId, content } = req.body;

    let user;
    try {
        user = await db.query('SELECT username, intraid FROM users WHERE u_id = $1', [authorId]);
        user = user.rows[0]
    } catch (e) {
        console.log(e);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to create blog, please try again later'
        })
    }
    if (!user) {
        return res.status(404).json({
            status: 'error',
            message: 'Could not find user with provided id'
        })
    }

    const client = await db.connect();
    let createdBlog;
    try{
        await client.query('BEGIN');
        let res = await client.query('INSERT INTO commentthreads DEFAULT VALUES RETURNING t_id');
        res = res.rows[0];
        createdBlog = await client.query(
            'INSERT INTO blogs(title, content, author, commentthread) VALUES($1, $2, $3, $4) RETURNING b_id, title, content, author, commentthread',
            [
                title,
                content,
                authorId,
                res.t_id
            ]
        );
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        console.log(e);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to create blogpost, please try again later.'
        })
    } finally {
        client.release();
    }

    res.status(201).json({blog: createdBlog.rows[0]})
};

exports.getBlogs = getBlogs;
exports.getBlogById = getBlogById;
exports.getBlogsByUserId = getBlogsByUserId;
exports.createBlog = createBlog;