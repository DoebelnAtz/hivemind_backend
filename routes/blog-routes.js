const express = require('express');
const { check } = require('express-validator');

const blogsController = require('../controllers/blog-controllers');
const commentController = require('../controllers/comment-controllers');
const router = express.Router();

// We can get posts by POST or GET, POST method can include senderId to check if sender has liked a post

router.get('/', blogsController.getBlogs);

router.get('/:bid', blogsController.getBlogById);

router.get('/users/:uid', blogsController.getBlogsByUserId);

// Same as blogs, we can get comment threads by POST or GET to check likes,

router.get('/commentthread/:tid', commentController.getCommentThreadById);

router.delete('/comment/delete_comment', commentController.deleteComment);

router.put('/update_blog', blogsController.updateBlog);

router.post(
	'/create_blog',
	[
		check('title')
			.not()
			.isEmpty(),
		check('content')
			.not()
			.isEmpty(),
	],
	blogsController.createBlog,
);

router.post(
	'/vote_blog',
	[
		check('blogId')
			.not()
			.isEmpty()
			.isNumeric(),
		check('vote')
			.not()
			.isEmpty()
			.isNumeric(),
	],
	blogsController.voteBlog,
);

router.post(
	'/create_comment',
	[
		check('threadId')
			.not()
			.isEmpty(),
		check('content')
			.not()
			.isEmpty(),
	],
	commentController.createComment,
);

router.delete(
	'/delete_blog',
	[
		check('blogId')
			.not()
			.isEmpty()
			.isNumeric(),
	],
	blogsController.deleteBlog,
);

router.delete(
	'/delete_comment',
	[
		check('commentId')
			.not()
			.isEmpty()
			.isNumeric(),
	],
	commentController.deleteComment,
);

module.exports = router;
