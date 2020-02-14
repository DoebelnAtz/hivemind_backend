const { validationResult } = require('express-validator');
const { errorLogger, accessLogger } = require('../logger');
const db = require('../queries');

const getCommentThreadById = async (req, res) => {
	const { tid } = req.params;

	let sender;

	const { senderId } = req.decoded.u_id;

	try {
		// could be optimized by returning necessary comment data through comments JOIN voted..., keep as is for now..
		sender = await db.query(
			'SELECT comment_id, vote ' +
				'FROM users join votedcomments ON votedcomments.user_id = users.u_id ' +
				'WHERE users.u_id = $1',
			[senderId],
		);
		sender = sender.rows.map((row) => {
			return {
				c_id: row.comment_id,
				vote: row.vote,
			};
		});
	} catch (e) {
		errorLogger.error('Failed to retrieve blogs: ' + e);
		return res.status(500).json({
			status: 'error',
			message: 'Failed to get blogs',
		});
	}

	let commentThread;
	try {
		commentThread = await db.query(
			'SELECT comments.c_id, commentcontent, author, parentthread, ' +
				'comment_date, childthread, username, profile_pic, u_id ' +
				'FROM comments JOIN users ON comments.parentthread = $1 ' +
				'WHERE comments.author = users.u_id ORDER BY comment_date ASC',
			[tid],
		);
		commentThread = commentThread.rows;
	} catch (e) {
		errorLogger.error('Failed to retrieve comments: ' + e);
		return res.status(500).json({
			status: 'error',
			message: 'Failed to retrieve comments.',
		});
	}
	res.json(
		commentThread.map((comment) => {
			return {
				...comment,
				vote: sender.find((v) => {
					return v.c_id === comment.c_id;
				})
					? sender.find((v) => v.c_id === comment.c_id).vote
					: 'no',
				// sends true if up voted, false if down voted,
				// 'no' if not voted.. not perfect, table value is boolean, worth changing?
			};
		}),
	);
};

const createComment = async (req, res) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({
			status: 'error',
			message: 'Invalid inputs passed, please check your data.',
		});
	}
	const authorId = req.decoded.u_id;
	const { threadId, content } = req.body;
	console.log(threadId, content, authorId);
	let thread;
	try {
		thread = await db.query(
			'SELECT * FROM commentthreads WHERE t_id = $1',
			[threadId],
		);
		if (!(thread = thread.rows[0]))
			return res.status(401).json({
				status: 'error',
				message:
					'Failed to find comment thread with the given thread id',
			});
	} catch (e) {
		return res.status(500).json({
			status: 'error',
			message: 'Failed to create comment, please try again later',
		});
	}

	let commentAuthor;
	try {
		commentAuthor = await db.query(
			'SELECT username, intraid, profile_pic FROM users ' +
				'WHERE u_id = $1',
			[authorId],
		);
		if (!(commentAuthor = commentAuthor.rows[0]))
			return res.status(401).json({
				status: 'error',
				message: 'Failed to find user with the given user id',
			});
	} catch (e) {
		return res.status(500).json({
			status: 'error',
			message: 'Failed to create comment, please try again later',
		});
	}

	const client = await db.connect();
	let createdComment;
	try {
		await client.query('BEGIN');
		let res = await client.query(
			'INSERT INTO commentthreads DEFAULT VALUES RETURNING t_id',
		);
		res = res.rows[0];
		createdComment = await client.query(
			'INSERT INTO comments(commentcontent, author, parentthread, childthread) ' +
				'VALUES($1, $2, $3, $4) ' +
				'RETURNING c_id, commentcontent, author, parentthread, childthread, comment_date',
			[content, authorId, threadId, res.t_id],
		);
		await client.query('COMMIT');
	} catch (e) {
		await client.query('ROLLBACK');
		errorLogger.error('Failed to create comment: ' + e);
		return res.status(500).json({
			status: 'error',
			message: 'Failed to create comment',
		});
	} finally {
		client.release();
	}
	res.status(201).json({ ...createdComment.rows[0], ...commentAuthor });
};

exports.getCommentThreadById = getCommentThreadById;
exports.createComment = createComment;
