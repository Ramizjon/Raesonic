module.exports = function(core)
{
	var RelationController =
	{
		// Vote update reasons
		MODE_CREATE_RELATION: 1,
		MODE_UPDATE_VOTE: 2,
		// Response status codes
		STATUS_CREATED: 1,
		STATUS_UPVOTED: 2,
		// User vote types
		VOTE_POSITIVE: 1,
		VOTE_CLEAR: 0,
		VOTE_NEGATIVE: -1,
	};

	var app = core.app;
	var sequelize = core.sequelize;
	var paperwork = core.paperwork;

	var Track = sequelize.models.Track;
	var Relation = sequelize.models.Relation;
	var RelationVote = sequelize.models.RelationVote;
	var RelationFlag = sequelize.models.RelationFlag;

	// Create a relation between two tracks
	RelationController.createRelation = function(req, res)
	{
		if(!req.user)
			return res.status(401).json({ errors: ["not authenticated"] });

		if(req.body.trackId == req.body.linkedId)
			return res.status(400).json({ errors: ["self-link not allowed"] });

		Track.count
		({
			where:
			{
				$or:
				[
					{ trackId: req.body.trackId },
					{ trackId: req.body.linkedId }
				]
			}
		})
		.then(function(amount)
		{
			// At least one of the tracks is missing to create a relation
			if(amount != 2)
				return res.status(404).json({ errors: ["track not found"] });

			// todo: use ReputationController.getVoteValue(req.user)
			var voteValue = 1;

			sequelize.transaction(function(tr)
			{
				return Relation.findOrCreate
				({
					where:
					{
						$or:
						[
							{
								trackId: req.body.trackId,
								linkedId: req.body.linkedId,
							},
							{
								trackId: req.body.linkedId,
								linkedId: req.body.trackId,
							}
						]
					},
					defaults:
					{
						trackId: req.body.trackId,
						linkedId: req.body.linkedId,
						trust: voteValue,
					},
					transaction: tr,
				})
				.spread(function(relation, created)
				{
					// If the relation already exists, upvote it and bail out
					if(!created)
						return relation;

					return RelationVote.create
					({
						relationId: relation.relationId,
						userId: req.user.userId,
						value: voteValue
					},
					{ transaction: tr });
				});
			})
			.then(function(entity)
			{
				// If the relation already exists, upvote it and bail out
				if(entity.Model == Relation)
				{
					RelationController.setRelationVote(entity, 1, req, res,
						RelationController.MODE_CREATE_RELATION);

					return;
				}

				res.json
				([
					entity.relationId,
					RelationController.STATUS_CREATED,
				]);
			})
			.catch(function(err)
			{
				return res.status(500).json({ errors: ["internal error"] });
			});
		});
	}

	// Retrieve track relations
	RelationController.getTrackRelations = function(req, res)
	{
		var trackId = req.params.trackId;

		var include =
		[{
			model: Track,
			as: "Track"
		},
		{
			model: Track,
			as: "Linked"
		}];

		if(req.user)
		{
			include.push
			({
				model: RelationVote,
				attributes: ["voteId", "value", "userId"],
				where:
				{
					userId: req.user.userId,
				},
				required: false,
			});

			include.push
			({
				model: RelationFlag,
				attributes: ["flagId", "resolved", "userId"],
				where:
				{
					userId: req.user.userId,
					resolved: 0,
				},
				required: false,
			});
		}

		Relation.all
		({
			attributes: ["relationId", "trackId", "linkedId", "trust", "doubt"],
			where:
			{
				$or:
				[
					{ trackId: trackId },
					{ linkedId: trackId }
				]
			},
			limit: 100,
			include: include,
		})
		.then(function(relations)
		{
			// No results, return an empty array
			if(!relations)
				return res.json( [] );

			var response = [];

			for(var index in relations)
			{
				// Retrieve data of tracks opposite to the request origin
				var track = (relations[index].Track.trackId == trackId)
					? relations[index].Linked
					: relations[index].Track;

				response.push
				([
					track.trackId,
					track.artist,
					track.title,
					(relations[index].trust - relations[index].doubt),
					(relations[index].RelationVotes != null)
						&& (relations[index].RelationVotes[0] != null)
							? relations[index].RelationVotes[0].value
							: 0,
					(relations[index].RelationFlags != null)
						&& (relations[index].RelationFlags[0] != null),
				]);
			}

			res.json(response);
		});
	}

	// Update user's vote on a relation
	RelationController.updateRelationVote = function(req, res)
	{
		if(!req.user)
			return res.status(401).json({ errors: ["not authenticated"] });

		Relation.findOne
		({
			attributes: ["relationId", "trust", "doubt"],
			where:
			{
				$or:
				[
					{
						trackId: req.params.trackId,
						linkedId: req.params.linkedId
					},
					{
						trackId: req.params.linkedId,
						linkedId: req.params.trackId
					}
				]
			}
		})
		.then(function(relation)
		{
			// Relation doesn't exist, nothing to vote on
			if(!relation)
				return res.status(404).json({ errors: ["relation not found"] });

			RelationController.setRelationVote(relation, req.body.vote, req, res,
				RelationController.MODE_UPDATE_VOTE);
		});
	}

	// Find or create a relation vote
	RelationController.setRelationVote = function(relation, vote, req, res, mode)
	{
		if(vote == RelationController.VOTE_CLEAR)
			return RelationController.clearRelationVote(relation, req, res);

		// todo: use ReputationController.getVoteValue(req.user) * vote;
		var voteValue = 1 * vote;

		sequelize.transaction(function(tr)
		{
			return RelationVote.findOrCreate
			({
				attributes: ["voteId", "value", "relationId", "userId"],
				where:
				{
					relationId: relation.relationId,
					userId: req.user.userId,
				},
				defaults: { value: voteValue },
				transaction: tr,
			})
			.spread(function(relationVote, created)
			{
				// New vote created, update relation and bail out
				if(created)
					return RelationController.updateRelationTrust(relation,
						voteValue, tr);

				// Revert trust changes from the previous user's vote
				relation = RelationController.revertPreviousVote(relation,
					relationVote.value);

				// Vote value has not changed, bail out
				if(relationVote.value == voteValue)
					return relation;

				return relationVote.update
				({
					value: voteValue
				},
				{ transaction: tr })
				.then(function()
				{
					// Add current vote and apply trust changes
					return RelationController.updateRelationTrust(relation,
						voteValue, tr);
				});
			});
		})
		.then(function(relation)
		{
			// The user attempted to create a relation that already exists
			// Send a response that the relation was successfully upvoted
			if(mode == RelationController.MODE_CREATE_RELATION)
			{
				res.json
				([
					relation.relationId,
					RelationController.STATUS_UPVOTED,
				]);

				return;
			}

			res.json
			([
				(relation.trust - relation.doubt),
				voteValue,
			]);
		})
		.catch(function(err)
		{
			return res.status(500).json({ errors: ["internal error"] });
		});
	}

	// Clear existing relation vote
	RelationController.clearRelationVote = function(relation, req, res)
	{
		sequelize.transaction(function(tr)
		{
			return RelationVote.findOne
			({
				attributes: ["voteId", "value", "relationId", "userId"],
				where:
				{
					relationId: relation.relationId,
					userId: req.user.userId,
				},
				transaction: tr,
			})
			.then(function(relationVote)
			{
				// Relation vote doesn't exist, bail out
				if(!relationVote)
					return relation;

				// Revert trust changes from the previous user's vote
				relation = RelationController.revertPreviousVote(relation,
					relationVote.value);

				// Delete existing vote
				return relationVote.destroy
				({
					transaction: tr,
				})
				.then(function()
				{
					// Apply trust changes
					return RelationController.updateRelationTrust(relation, 0, tr);
				});
			});
		})
		.then(function(relation)
		{
			res.json
			([
				(relation.trust - relation.doubt),
				0,
			]);
		})
		.catch(function(err)
		{
			return res.status(500).json({ errors: ["internal error"] });
		});
	}

	// Revert trust changes from the previous user's vote
	RelationController.revertPreviousVote = function(relation, voteValue)
	{
		(voteValue > 0)
			? relation.trust = relation.trust - voteValue
			: relation.doubt = relation.doubt + voteValue;

		return relation;
	}

	// Apply vote changes to a relation
	RelationController.updateRelationTrust = function(relation, voteValue, tr)
	{
		// If a new vote has been set
		if(voteValue)
		{
			// Adjust trust based on the new vote
			(voteValue > 0)
				? relation.trust = relation.trust + voteValue
				: relation.doubt = relation.doubt - voteValue;
		}

		return relation.update
		({
			trust: relation.trust,
			doubt: relation.doubt
		},
		{ transaction: tr });
	}

	// Returns true if the id is in valid range
	RelationController.validateId = function(id)
	{
		return (id > 0);
	}

	// Returns true if the vote is valid
	RelationController.validateVote = function(vote)
	{
		return (vote == -1 || vote == 0 || vote == 1);
	}

	RelationController.init = function()
	{
		app.post("/relations",
			paperwork.accept
			({
				trackId: paperwork.all(Number, RelationController.validateId),
				linkedId: paperwork.all(Number, RelationController.validateId),
			}),
			RelationController.createRelation);

		app.get("/tracks/:trackId(\\d+)/relations",
			RelationController.getTrackRelations);

		app.put("/tracks/:trackId(\\d+)/relations/:linkedId(\\d+)/votes",
			paperwork.accept
			({
				vote: paperwork.all(Number, RelationController.validateVote),
			}),
			RelationController.updateRelationVote);
	}

	return RelationController;
}
