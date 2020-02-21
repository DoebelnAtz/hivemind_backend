const { validationResult } = require('express-validator');
const { errorLogger, accessLogger } = require('../logger');
const db = require('../queries');

const addTaskToBoard = async (req, res) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(422).json({
			status: 'error',
			message: 'Invalid input please try again.',
		});
	}
	const userId = req.decoded.u_id;

	const { taskTitle, taskColumnId } = req.body;

	const client = await db.connect();
	let createdTask;
	try {
		await client.query('BEGIN');
		createdTask = await client.query(
			'INSERT INTO tasks (title, column_id) VALUES ($1, $2)' +
				'RETURNING task_id, title, priority, description',
			[taskTitle, taskColumnId],
		);
		createdTask = createdTask.rows[0];
		await client.query(
			'INSERT INTO taskcollaborators (task_id, u_id) VALUES ($1, $2)',
			[createdTask.task_id, userId],
		);
		await client.query('COMMIT');
	} catch (e) {
		await client.query('ROLLBACK');
		errorLogger.error('Failed to add task: ' + e);
		return res.status(500).json({
			success: false,
			status: 'error',
			message: 'Failed to add task.',
		});
	} finally {
		client.release();
	}

	let collaborators;
	try {
		collaborators = await db.query(
			'SELECT t.task_id, u.username, u.profile_pic, u.u_id FROM tasks t ' +
				'JOIN taskcollaborators c ON c.task_id = t.task_id ' +
				'JOIN users u ON c.u_id = u.u_id ' +
				'WHERE t.task_id = $1',
			[createdTask.task_id],
		);
		collaborators = collaborators.rows;
	} catch (e) {
		errorLogger.error('Failed to get collaborators to task: ' + e);
		return res.status(500).json({
			status: 'error',
			message: 'Failed to get collaborators to task',
		});
	}
	res.status(201).json({ ...createdTask, collaborators: collaborators });
};

const createProject = async (req, res) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(422).json({
			status: 'error',
			message: 'Invalid input please try again.',
		});
	}
	const userId = req.decoded.u_id;
	const { title, link, description } = req.body;

	let createdProject;
	const client = await db.connect();
	try {
		await client.query('BEGIN');
		let commentthread = await client.query(
			`INSERT INTO commentthreads DEFAULT VALUES 
			RETURNING t_id`,
		);
		commentthread = commentthread.rows[0];
		let chatthread = await client.query(
			`INSERT INTO threads (thread_name) VALUES ($1) 
			RETURNING t_id`,
			[title],
		);
		chatthread = chatthread.rows[0];
		createdProject = await client.query(
			`INSERT INTO projects 
			(title, description, link, t_id, commentthread) 
			VALUES ($1, $2, $3, $4, $5) RETURNING *`,
			[title, description, link, chatthread.t_id, commentthread.t_id],
		);
		createdProject = createdProject.rows[0];
		let board = await client.query(
			`INSERT INTO boards (title, project_id) 
			VALUES ($1, $2) RETURNING board_id`,
			[title, createdProject.project_id],
		);
		board = board.rows[0];
		let boardTitles = [
			'Backlog',
			'Breakdown',
			'In Development',
			'Testing',
			'Implementing',
		];

		for (var i = 0; i < 5; i++) {
			let column = await client.query(
				`INSERT INTO boardcolumns 
				(board_id, title) VALUES 
				($1, $2)`,
				[board.board_id, boardTitles[i]],
			);
		}
		await client.query(
			`INSERT INTO projectcollaborators 
			(u_id, project_id) VALUES ($1, $2) RETURNING
			project_id, u_id`,
			[userId, createdProject.project_id],
		);
		await client.query(
			`INSERT INTO threadconnections 
			(user_id, thread_id) VALUES ($1, $2)`,
			[userId, chatthread.t_id],
		);
		let collaborators = await client.query(
			`SELECT u.username, u.profile_pic, u.u_id
			FROM users u JOIN projectcollaborators c ON c.u_id = u.u_id 
			WHERE c.project_id = $1`,
			[createdProject.project_id],
		);
		collaborators = collaborators.rows;
		createdProject = { ...createdProject, collaborators: collaborators };
		await client.query('COMMIT');
	} catch (e) {
		await client.query('ROLLBACK');
		errorLogger.error('Failed to create project: ' + e);
		return res.status(500).json({
			success: false,
			status: 'error',
			message: 'Failed to create project.',
		});
	} finally {
		client.release();
	}
	res.json(createdProject);
};

const addCollaboratorToTask = async (req, res) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(422).json({
			status: 'error',
			message: 'Invalid input please try again.',
		});
	}
	const { userId, taskId } = req.body;

	try {
		await db.query(
			'INSERT INTO taskcollaborators (u_id, task_id) VALUES ($1, $2)',
			[userId, taskId],
		);
	} catch (e) {
		errorLogger.error('Failed to add collaborator to task: ' + e);
		return res.status(500).json({
			status: 'error',
			message: 'Failed to add collaborator to task',
		});
	}
	let collaborators;
	try {
		collaborators = await db.query(
			'' +
				'SELECT t.task_id, u.username, u.profile_pic, u.u_id FROM tasks t ' +
				'JOIN taskcollaborators c ON c.task_id = t.task_id ' +
				'JOIN users u ON c.u_id = u.u_id ' +
				'WHERE t.task_id = $1',
			[taskId],
		);
		collaborators = collaborators.rows;
	} catch (e) {
		errorLogger.error('Failed to get collaborators to task: ' + e);
		return res.status(500).json({
			status: 'error',
			message: 'Failed to get collaborators to task',
		});
	}
	res.status(201).json({ collaborators });
};

const getBoardById = async (req, res) => {
	const boardId = req.params.bid;
	// lol, this will be fun to optimize..
	let board;

	try {
		board = await db.query(
			`SELECT 
            u.username, u.profile_pic, u.u_id, 
            c.title, c.column_id, 
            b.board_id, 
            t.priority, t.title AS task_title, t.task_id, t.description 
            FROM boards b 
            JOIN boardcolumns c 
            ON b.board_id = c.board_id 
            LEFT JOIN tasks t ON t.column_id = c.column_id 
            LEFT JOIN taskcollaborators tc ON tc.task_id = t.task_id 
            LEFT JOIN users u ON u.u_id = tc.u_id WHERE b.board_id = $1 ORDER BY c.column_id ASC, task_title ASC`,
			[boardId],
		);
		board = board.rows;

		let columns = [];
		let prevCol = 0;
		let taskIndex = -1;
		let colIndex = -1;
		let prevTask = 0;

		for (let i = 0; i < board.length; i++) {
			if (board[i].column_id !== prevCol) {
				colIndex++;
				columns.push({
					title: board[i].title,
					column_id: board[i].column_id,
					column_number: colIndex,
					tasks: [],
				});
				taskIndex = -1;
			}
			if (board[i].task_id !== prevTask && !!board[i].task_id) {
				taskIndex++;
				columns[colIndex].tasks.push({
					title: board[i].task_title,
					task_id: board[i].task_id,
					priority: board[i].priority,
					collaborators: [],
				});
			}
			if (!!board[i].u_id) {
				columns[colIndex].tasks[taskIndex].collaborators.push({
					u_id: board[i].u_id,
					username: board[i].username,
					profile_pic: board[i].profile_pic,
				});
			}

			prevTask = board[i].task_id;
			prevCol = board[i].column_id;
		}
		board = { columns };
	} catch (e) {
		errorLogger.error('Failed to get board by Id: ' + e);
		return res.status(500).json({
			status: 'error',
			message: 'Failed to get board by Id',
		});
	}
	res.json(board);
};

const getProjects = async (req, res) => {
	const page = req.query.page;
	const userId = req.decoded.u_id;
	const filter = req.query.filter;
	const order = req.query.order;
	const reverse = req.query.reverse;
	// we are dangerously inserting values into a query so we need to make sure that
	// the order parameter is correct
	if (order !== 'popular' && order !== 'recent' && order !== 'title') {
		errorLogger.error('Failed to get projects: invalid order parameter');
		return res.status(422).json({
			status: 'error',
			message: 'Failed to get resources',
		});
	}
	let order1;
	let order2;
	let reverseOrder;
	switch (order) {
		case 'popular':
			reverseOrder = reverse === 'true' ? 'ASC' : 'DESC';
			order1 = `p.votes ${reverseOrder}`;
			order2 = 'p.published_date DESC';
			break;
		case 'recent':
			reverseOrder = reverse === 'true' ? 'ASC' : 'DESC';
			order1 = `p.published_date ${reverseOrder}`;
			order2 = 'p.votes DESC';
			break;
		default:
			reverseOrder = reverse === 'true' ? 'DESC' : 'ASC';
			order1 = `p.title ${reverseOrder}`;
			order2 = 'p.published_date DESC';
	}

	let projects;
	try {
		projects = await db.query(
			`SELECT p.title, p.published_date, 
			p.votes, p.project_id, v.vote 
			FROM projects p LEFT JOIN (SELECT vote, project_id FROM projectvotes WHERE u_id = $1) v 
			ON v.project_id = p.project_id ORDER BY ${order1}, ${order2} LIMIT $2 OFFSET $3`,
			[userId, Number(page) * 10, Number(page - 1) * 10],
		);
		projects = projects.rows;
	} catch (e) {
		errorLogger.error('Failed to get projects: ' + e);
		return res.status(500).json({
			status: 'error',
			message: 'Failed to get projects',
		});
	}

	for (var i = 0; i < projects.length; i++) {
		try {
			let resp = await db.query(
				'SELECT u.profile_pic, u.u_id, u.username ' +
					'FROM projects p JOIN projectcollaborators c ON c.project_id = p.project_id ' +
					'JOIN users u ON c.u_id = u.u_id WHERE p.project_id = $1',
				[projects[i].project_id],
			);
			projects[i].collaborators = resp.rows;
		} catch (e) {
			errorLogger.error('Failed to get projects: ' + e);
			return res.status(500).json({
				status: 'error',
				message: 'Failed to get projects.',
			});
		}
	}
	res.json(projects);
};

const getProjectById = async (req, res) => {
	const projectId = req.params.pid;
	const userId = req.decoded.u_id;

	let contributor = false;
	let project;
	try {
		project = await db.query(
			'SELECT p.title, p.commentthread, ' +
				'b.board_id, p.project_id, p.votes, p.t_id, p.description, p.link, p.published_date ' +
				'FROM projects p JOIN boards b ' +
				'ON b.project_id = p.project_id AND p.project_id = $1',
			[projectId],
		);
		project = project.rows[0];
	} catch (e) {
		errorLogger.error('Failed to get project by id: ' + e);
		return res.status(500).json({
			status: 'error',
			message: 'Failed to get project by id',
		});
	}

	let collaborators;

	try {
		collaborators = await db.query(
			'SELECT u.username, u.u_id, u.profile_pic FROM users u ' +
				'JOIN projectcollaborators c ON c.u_id = u.u_id AND c.project_id = $1',
			[projectId],
		);
		collaborators = collaborators.rows;
		for (var i = 0; i < collaborators.length; i++) {
			if (collaborators[i].u_id === userId) contributor = true;
		}
	} catch (e) {
		errorLogger.error('Failed to get project by id: ' + e);
		return res.status(500).json({
			status: 'error',
			message: 'Failed to get project by id',
		});
	}

	res.json({ ...project, contributor, collaborators });
};

const getProjectCollaborators = async (req, res) => {

	let projectId = req.query.projectId;

	let collaborators;
	try {
	    collaborators = await db.query(
	        `SELECT u.username, u.profile_pic, u.u_id
	        FROM users u JOIN projectcollaborators c
	        ON c.u_id = u.u_id WHERE c.project_id = $1`
            , [projectId]);
	    collaborators = collaborators.rows;
	} catch(e) {
        errorLogger.error('Failed to get project collaborators: ' + e);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to get project collaborators'
        })
    }
    res.json(collaborators);
};

const updateProject = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({
            status: 'error',
            message: 'Invalid input please try again.',
        });
    }

    const { projectId, title, description } = req.body;

    const client = await db.connect();

    try{
        await client.query('BEGIN');
        await client.query(
            `UPDATE projects SET title = $1, description = $2 WHERE project_id = $3`
        ,[title, description, projectId]
        );
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        errorLogger.error('Failed to update Project: ' + e);
        return res.status(500).json({
            success: false,
            status: 'error',
            message: 'Failed to update Project.'
        })
    } finally {
        client.release();
    }
    res.json({title: title, description: description})
};

const voteProject = async (req, res) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(422).json({
			status: 'error',
			message: 'Invalid input please try again.',
		});
	}
	let { vote, projectId } = req.body;
	const userId = req.decoded.u_id;
	let voteTarget;
	try {
		voteTarget = await db.query(
			`SELECT u_id, vote, project_id FROM projectvotes WHERE project_id = $1 AND u_id = $2`,
			[projectId, userId],
		);
		voteTarget = voteTarget.rows[0];
	} catch (e) {
		errorLogger.error('Failed to find target project for voting: ' + e);
		return res.status(500).json({
			status: 'error',
			message: 'Failed to find target project for voting',
		});
	}
	const client = await db.connect();

	try {
		await client.query('BEGIN');
		if (!!voteTarget) {
			switch (vote) {
				case 0:
					vote = -voteTarget.vote;
					await client.query(
						`DELETE FROM projectvotes 
                            WHERE project_id = $1 AND u_id = $2`,
						[projectId, userId],
					);
					break;
				case 1:
					vote = 2;
					await client.query(
						`UPDATE projectvotes 
                            SET vote = 1 
                            WHERE project_id = $1 AND u_id = $2`,
						[projectId, userId],
					);
					break;
				case -1:
					vote = -2;
					await client.query(
						`UPDATE projectvotes 
                            SET vote = -1 
                            WHERE project_id = $1 AND u_id = $2`,
						[projectId, userId],
					);
					break;
				default:
					errorLogger.error(
						'Failed to vote resource: Invalid vote input',
					);
					return res.status(500).json({
						success: false,
						status: 'error',
						message: 'Failed to vote resource.',
					});
			}
		} else {
			await client.query(
				`INSERT INTO 
                    projectvotes (project_id, u_id, vote) 
                    VALUES ($1, $2, $3)`,
				[projectId, userId, vote],
			);
		}
		await client.query(
			'UPDATE projects SET votes = votes + $1 WHERE project_id = $2',
			[vote, projectId],
		);
		await client.query('COMMIT');
	} catch (e) {
		await client.query('ROLLBACK');
		errorLogger.error('Failed to vote resource: ' + e);
		return res.status(500).json({
			success: false,
			status: 'error',
			message: 'Failed to vote resource.',
		});
	} finally {
		client.release();
	}
	res.json({ success: true });
};

const updateColumnTitle = async (req, res) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(422).json({
			status: 'error',
			message: 'Invalid input please try again.',
		});
	}
	const { title, columnId } = req.body;
	let newTitle;
	try {
		newTitle = await db.query(
			`UPDATE boardcolumns SET title = $1 
            WHERE column_id = $2 
            RETURNING title`,
			[title, columnId],
		);
		newTitle = newTitle.rows[0];
	} catch (e) {
		errorLogger.error('Failed to update column title: ' + e);
		return res.status().json({
			status: 'error',
			message: 'Failed to update column title',
		});
	}
	res.json({ title: newTitle.title });
};

const updateTaskPosition = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({
            status: 'error',
            message: 'Invalid input please try again.',
        });
    }
	const updatedTask = req.body;
	try {
		await db.query('UPDATE tasks SET column_id = $1 WHERE task_id = $2', [
			updatedTask.column_id,
			updatedTask.task_id,
		]);
	} catch (e) {
		errorLogger.error('Failed to update task: ' + e);
		return res.status(500).json({
			success: false,
			status: 'error',
			message: 'Failed to update task',
		});
	}
	res.json({ success: true });
};

const updateTask = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({
            status: 'error',
            message: 'Invalid input please try again.',
        });
    }
	const updatedTask = req.body;
	try {
		await db.query(
			'UPDATE tasks ' +
				'SET title = $1, column_id = $2, ' +
				'description = $3, priority = $4' +
				'WHERE task_id = $5',
			[
				updatedTask.title,
				updatedTask.column_id,
				updatedTask.description,
				Number(updatedTask.priority),
				updatedTask.task_id,
			],
		);
	} catch (e) {
		errorLogger.error('Failed to update task: ' + e);
		return res.status(500).json({
			success: false,
			status: 'error',
			message: 'Failed to update task',
		});
	}
	res.json({ success: true });
};

const deleteTask = async(req,res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({
            status: 'error',
            message: 'Invalid input please try again.',
        });
    }
	const { taskId } = req.body;

	const senderId = req.decoded.u_id;
	let targetTask;
	try {
	    targetTask = await db.query(
	        `SELECT t.task_id, t.commentthread, c.u_id 
	        FROM tasks t JOIN taskcollaborators c 
	        ON c.task_id = t.task_id
	        WHERE t.task_id = $1 AND c.u_id = $2`, [taskId, senderId]);
	    targetTask = targetTask.rows[0];
	} catch(e) {
	    errorLogger.error('Failed to find task to delete: ' + e);
	    return res.status(500).json({
	        status: 'error',
	        message: 'Failed to find task to delete'
	    })
	}
	const client = await db.connect();

    try{
        await client.query('BEGIN');
        await client.query(
            'DELETE FROM taskcollaborators ' +
            'WHERE task_id = $1', [taskId]);
        if (targetTask.commentthread) {
            await client.query(`
                DELETE FROM commentthreads WHERE t_id = $1
            `, [targetTask.commentthread])
        }
        await client.query(`
            DELETE FROM tasks WHERE task_id = $1
        `,[taskId]);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        errorLogger.error('Failed to delete task: ' + e);
        return res.status(500).json({
            success: false,
            status: 'error',
            message: 'Failed to delete task.'
        })
    } finally {
        client.release();
    }
    res.json({success: true})
};

const getTaskById = async (req, res) => {
	const userId = req.decoded.u_id;
	const taskId = req.params.tid;
	let task;
	try {
		task = await db.query(
			'SELECT t.priority, t.description, t.task_id, t.title, t.column_id FROM tasks t ' +
				'WHERE t.task_id = $1',
			[taskId],
		);

		let collaborators = await db.query(
			'SELECT u.username, u.profile_pic, u.u_id ' +
				'FROM users u JOIN taskcollaborators c ON c.u_id = u.u_id ' +
				'WHERE c.task_id = $1',
			[taskId],
		);
		task = {
			...task.rows[0],
			collaborators: collaborators.rows,
			owner: !!collaborators.rows.find((col) => col.u_id === userId),
		};
	} catch (e) {
		errorLogger.error('Failed to get task: ' + e);
		return res.status(500).json({
			status: 'error',
			message: 'Failed to get task',
		});
	}
	res.json(task);
};

const addProjectCollaborator = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({
            status: 'error',
            message: 'Invalid input please try again.',
        });
    }

    const { userId, projectId } = req.body;
    const senderId = req.decoded.u_id;

    let targetUser;
    let senderCollaborator;
    let targetProject;
    try {
        targetUser = await db.query(
            `SELECT username, u_id, profile_pic FROM users WHERE u_id = $1`, [userId]);
        targetUser = targetUser.rows[0];
        senderCollaborator = await db.query(
            `SELECT u_id, project_id FROM projectcollaborators WHERE u_id = $1 AND project_id = $2`
            , [senderId, projectId]
        );
        senderCollaborator = senderCollaborator.rows;
        console.log(senderCollaborator);
        if (!senderCollaborator.length) {
            errorLogger.error('Failed to add user to project: unauthorized sender');
            return res.status(403).json({
                status: 'error',
                message: 'Failed to add user to project: unauthorized sender'
            })
        }
        else {
            senderCollaborator = senderCollaborator[0]
        }
        targetProject = await db.query(
            `SELECT project_id, t_id FROM projects WHERE project_id = $1`
            ,[projectId]
        );
        targetProject = targetProject.rows;
        if (!targetProject.length) {
            errorLogger.error('Failed to add user to project: no project found matching given id');
            return res.status(404).json({
                status: 'error',
                message: 'Failed to add user to project: no project found matching given id'
            })
        }
        else {
            targetProject = targetProject[0]
        }
    } catch(e) {
        errorLogger.error('Failed to find user to add: ' + e);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to find user to add'
        })
    }

    const client = await db.connect();

        try{
            await client.query('BEGIN');
            await client.query(
                `INSERT INTO threadconnections (thread_id, user_id) VALUES ($1, $2)`
                ,[targetProject.t_id, userId]);
            await client.query(
                `INSERT INTO projectcollaborators (project_id, u_id) VALUES ($1, $2)`
                ,[projectId, userId]);
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            errorLogger.error('Failed to add user to project: ' + e);
            return res.status(500).json({
                success: false,
                status: 'error',
                message: 'Failed to add user to project.'
            })
        } finally {
            client.release();
        }
    res.json(targetUser)
};

exports.addTaskToBoard = addTaskToBoard;
exports.updateTask = updateTask;
exports.createProject = createProject;
exports.updateTaskPosition = updateTaskPosition;
exports.getBoardById = getBoardById;
exports.getProjects = getProjects;
exports.getProjectById = getProjectById;
exports.getTaskById = getTaskById;
exports.voteProject = voteProject;
exports.updateProject = updateProject;
exports.deleteTask = deleteTask;
exports.addCollaboratorToTask = addCollaboratorToTask;
exports.updateColumnTitle = updateColumnTitle;
exports.addProjectCollaborator = addProjectCollaborator;
exports.getProjectCollaborators = getProjectCollaborators;