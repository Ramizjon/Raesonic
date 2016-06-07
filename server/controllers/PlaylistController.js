module.exports = function(core)
{
	var RandomString = require("randomstring");

	var PlaylistController =
	{
		ACCESS:
		{
			PRIVATE: 1,
			SHARED: 2,
			PUBLIC: 3,
		},
		DEFAULT_ALIAS_LENGTH: 12,
		NAME_REGEX: /^[a-z0-9?!@#$%^&*();:_+\-= \[\]{}/|\\"<>'.,]+$/i,
		// Access methods
		BY_PLAYLISTID: 1,
		BY_ITEMID: 2,
		BY_ALIAS: 3,
	};

	var app = core.app;
	var sequelize = core.sequelize;
	var paperwork = core.paperwork;

	var Track = sequelize.models.Track;
	var Content = sequelize.models.Content;
	var Playlist = sequelize.models.Playlist;
	var Item = sequelize.models.Item;

	// Creates a new playlist with the specified name
	// Note: Main playlists are not created with this method
	PlaylistController.createPlaylist = function(req, res)
	{
		if(!req.user)
			return res.status(401).json({ errors: ["not authenticated"] });

		Playlist.create
		({
			name: req.body.name,
			userId: req.user.userId,
			access: req.body.access,
			alias: RandomString.generate(PlaylistController.DEFAULT_ALIAS_LENGTH),
		})
		.then(function(playlist)
		{
			res.json(playlist.playlistId);
		});
	}

	// Retrieve playlist info and items
	PlaylistController.getPlaylist = function(req, res)
	{
		var condition = req.params.alias.match(/[^$\d]/)
			? { alias: req.params.alias }
			: { playlistId: req.params.alias };

		PlaylistController.verifyAccess(req.user, condition, res,
		function onConfirm()
		{
			Playlist.findOne
			({
				attributes: ["playlistId", "name", "access"],
				where: condition,
				order: "itemId DESC",
				include:
				[{
					model: Item,
					attributes: ["itemId"],
					include:
					[{
						model: Content,
						attributes: ["sourceId", "externalId"],
						include:
						[{
							model: Track,
							attributes: ["trackId", "artist", "title"]
						}]
					}]
				}]
			})
			.then(function(playlist)
			{
				if(!playlist)
					return res.json( [] );

				var items = playlist.Items;
				var responseItems = [];

				for(var index in items)
				{
					responseItems.push
					([
						items[index].Content.Track.trackId,
						items[index].Content.Track.artist,
						items[index].Content.Track.title,
						items[index].itemId,
						items[index].Content.sourceId,
						items[index].Content.externalId
					]);
				}

				var response =
				[
					[
						playlist.playlistId,
						playlist.name,
						playlist.access,
						playlist.alias,
					],
					responseItems
				];

				res.json(response);
			});
		});
	}

	// Retrieve main playlist of the user
	PlaylistController.getMainPlaylist = function(req, res)
	{
		if(!req.user)
			return res.status(401).json({ errors: ["not authenticated"] });

		Playlist.findOne
		({
			where: { userId: req.user.userId },
			order: "playlistId ASC",
		})
		.then(function(playlist)
		{
			if(!playlist)
				return res.status(404).json({ errors: ["playlist not found"] });

			req.params.alias = playlist.playlistId.toString();
			PlaylistController.getPlaylist(req, res);
		});
	}

	// Add content as a new playlist item
	PlaylistController.addItem = function(req, res)
	{
		if(!req.user)
			return res.status(401).json({ errors: ["not authenticated"] });

		PlaylistController.verifyOwnership(req.user,
			PlaylistController.BY_PLAYLISTID, req.params.playlistId, res,
		function onConfirm(playlist)
		{
			// User is the playlist owner, proceed to adding the item
			// Content is obtained and created if it doesn't exist
			Content.findOrCreate
			({
				where:
				{
					sourceId: req.body.sourceId,
					externalId: req.body.externalId
				},
				defaults: { trackId: -1 },
				include:
				[{
					model: Track,
					attributes: ["trackId", "artist", "title"]
				}]
			})
			.spread(function(content, created)
			{
				sequelize.transaction(function(tr)
				{
					// Create new item linked with the obtained content
					return Item.create
					({
						playlistId: req.params.playlistId,
						contentId: content.contentId
					},
					{ transaction: tr })
					.then(function(item)
					{
						return playlist
						.increment("count",
						{ transaction: tr })
						.then(function()
						{
							// Default values if no track is attached
							return (!created)
								?
								[
									content.Track.trackId,
									content.Track.artist,
									content.Track.title,
									item.itemId,
								]
								:
								[
									-1,
									"Unknown Artist",
									"Unknown Track",
									item.itemId,
								];
						})
					});
				})
				.then(function(response)
				{
					res.json(response);
				})
				.catch(function(err)
				{
					return res.status(500).json({ errors: ["internal error"] });
				});
			});
		});
	}

	// Creates a main playlist for the newly created account
	PlaylistController.createMainPlaylist = function(user, tr)
	{
		return Playlist.create
		({
			name: "Main",
			userId: user.userId,
			alias: RandomString.generate(PlaylistController.DEFAULT_ALIAS_LENGTH),
		},
		{ transaction: tr })
		.then(function()
		{
			return user;
		});
	}

	// Calls confirm if the user is a playlist owner
	PlaylistController.verifyOwnership = function(user, method, entityId, res, confirm)
	{
		var params = {};

		switch(method)
		{
			case PlaylistController.BY_PLAYLISTID:
			{
				params =
				{
					attributes: ["playlistId", "userId"],
					where: { playlistId: entityId }
				};
				break;
			}
			case PlaylistController.BY_ITEMID:
			{
				params =
				{
					attributes: ["playlistId", "userId"],
					include:
					[{
						model: Item,
						where: { itemId: entityId }
					}]
				};
				break;
			}
			default:
			{
				return res.status(500).json({ errors: ["internal error"] });
			}
		}

		Playlist
		.findOne(params)
		.then(function(playlist)
		{
			if(!playlist)
				return res.status(404).json({ errors: ["playlist not found"] });

			if(user.userId != playlist.userId)
				return res.status(403).json({ errors: ["no access"] });

			confirm();
		});
	}

	// Calls confirm if the user can view playlist
	PlaylistController.verifyAccess = function(user, condition, res, confirm)
	{
		Playlist.findOne
		({
			attributes: ["userId", "access"],
			where: condition
		})
		.then(function(playlist)
		{
			if(!playlist)
				return res.status(404).json({ errors: ["playlist not found"] });

			// Playlist owners always have access
			if(user && user.userId == playlist.userId)
				return confirm();

			// Shared playlists can only be reached by their alias
			if(!condition.alias &&
				playlist.access == PlaylistController.ACCESS.SHARED)
				return res.status(403).json({ errors: ["no access"] });

			// Playlist owners don't reach this line, deny access
			if(playlist.access == PlaylistController.ACCESS.PRIVATE)
				return res.status(403).json({ errors: ["no access"] });

			confirm(playlist);
		});
	}

	// Returns true if the playlist name is valid
	PlaylistController.validateName = function(name)
	{
		if(name.length < 3 || name.length > 50)
			return false;

		if(!PlaylistController.NAME_REGEX.test(name))
			return false;

		return true;
	}

	// Returns true if the playlist access is valid
	PlaylistController.validateAccess = function(access)
	{
		return ( access == PlaylistController.ACCESS.PRIVATE ||
			access == PlaylistController.ACCESS.SHARED ||
			access == PlaylistController.ACCESS.PUBLIC );
	}
	
	PlaylistController.init = function()
	{
		var ContentController = core.controllers.Content;

		app.post("/playlists",
			paperwork.accept
			({
				name: paperwork.all(String, PlaylistController.validateName),
				access: paperwork.all(Number, PlaylistController.validateAccess),
			}),
			PlaylistController.createPlaylist);

		app.get("/playlists/:alias",
			PlaylistController.getPlaylist);

		app.get("/own/playlists/main",
			PlaylistController.getMainPlaylist);
		
		app.post("/playlists/:playlistId(\\d+)",
			paperwork.accept
			({
				sourceId: paperwork.all(Number, ContentController.validateSourceId),
				externalId: paperwork.all(String, ContentController.validateExternalId),
			}),
			PlaylistController.addItem);
	}

	return PlaylistController;
}
