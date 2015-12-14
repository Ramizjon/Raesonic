var express = require("express");
var app = express();
var bodyParser = require("body-parser");

var async = require("async");

var Sequelize = require("sequelize");
var sequelize = new Sequelize("raesonic", "user", "password",
{
	host: "localhost",
	dialect: "mysql",
	pool:
	{
		max: 5,
		min: 0,
		idle: 10000
	},
	define:
	{
		timestamps: false
	}
});

var Track = sequelize.define("Track",
{
	trackId: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
	artist: Sequelize.STRING(50),
	title: Sequelize.STRING(50)
});
var Content = sequelize.define("Content",
{
	contentId: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
	sourceId: Sequelize.INTEGER(1),
	externalId: Sequelize.STRING(20)
});
var Playlist = sequelize.define("Playlist",
{
	playlistId: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
	userId: Sequelize.INTEGER,
	name: Sequelize.STRING(50),
	access: { type: Sequelize.INTEGER(1), defaultValue: 1 }
});
var Item = sequelize.define("Item",
{
	itemId: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true }
});
var Relation = sequelize.define("Relation",
{
	relationId: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
	trust: Sequelize.INTEGER,
	doubt: Sequelize.INTEGER
});
Track.hasMany(Content, { foreignKey: "trackId" });
Content.belongsTo(Track, { foreignKey: "trackId" });
Track.hasMany(Relation, { foreignKey: "trackId" });
Relation.belongsTo(Track, { foreignKey: "trackId" });
Track.hasMany(Relation, { foreignKey: "linkedId" });
Relation.belongsTo(Track, { foreignKey: "linkedId" });
Content.hasMany(Item, { foreignKey: "contentId" });
Item.belongsTo(Content, { foreignKey: "contentId" });
Playlist.hasMany(Item, { foreignKey: "playlistId" });
Item.belongsTo(Playlist, { foreignKey: "playlistId" });

// Parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// Parse application/json
app.use(bodyParser.json());

app.route("/playlists")
.post(function(req, res)
{
	if(!req.body || !req.body.name) return res.status(500).json({ error: true });
	// todo: return error if not logged in
	// todo: return error if playlist name contains restricted characters
	// todo: use actual user id
	Playlist.create
	({
		name: req.body.name,
		userId: 1
	});
});

app.route("/playlists/:playlistId(\\d+)")
.get(function(req, res)
{
	Playlist.findOne
	({
		attributes: ["name", "access"],
		where: { playlistId: req.params.playlistId },
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
		if(!playlist) return res.json([]);
		// todo: return error if user has no access to playlist
		var response = [ [playlist.name, playlist.access], [] ];
		var items = playlist.Items;
		for(var index in items)
		{
			response[1][index] =
			[
				items[index].Content.Track.trackId,
				items[index].Content.Track.artist,
				items[index].Content.Track.title,
				items[index].itemId,
				items[index].Content.sourceId,
				items[index].Content.externalId
			];
		}
		res.json(response);
	});
})
.post(function(req, res)
{
	if(!req.body || !req.body.sourceId || !req.body.externalId) return res.status(500).json({ error: true });
	// todo: return error if not logged in
	// todo: return error if playlist does not belong to that user
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
		Item.create
		({
			playlistId: req.params.playlistId,
			contentId: content.contentId
		})
		.then(function(item)
		{
			if(created) return res.json([-1, "Unknown Artist", "Unknown Track", item.itemId]);
			res.json
			([
				content.Track.trackId,
				content.Track.artist,
				content.Track.title,
				item.itemId
			]);
		});
	});
});

app.route("/search/:query")
.get(function(req, res)
{
	var query = "%" + decodeURIComponent(req.params.query.replace(/\+/g, "%20")) + "%";
	Track.all
	({
		attributes: ["trackId", "artist", "title"],
		limit: 100,
		where:
		{
			trackId: { $gt: 0 },
			$or:
			[
				// todo: add combined search
				{ artist: { $like: query } },
				{ title: { $like: query } }
			]
		}
	})
	.then(function(tracks)
	{
		if(!tracks) return res.json([]);
		var response = [];
		for(var index in tracks)
		{
			response[response.length] =
			[
				tracks[index].trackId,
				tracks[index].artist,
				tracks[index].title
			];
		}
		res.json(response);
	});
});

app.route("/tracks/")
.post(function(req, res)
{
	if(!req.body || !req.body.itemId || !req.body.artist || !req.body.title) return res.status(500).json({ error: true });
	// todo: return error if not logged in
	Track.findOrCreate
	({
		where:
		{
			artist: req.body.artist,
			title: req.body.title
		}
	})
	.spread(function(track, created)
	{
		Content.findOne
		({
			attributes: ["contentId"],
			include:
			[{
				model: Item,
				where: { itemId: req.body.itemId }
			}]
		})
		.then(function(content)
		{
			Content.update
			({
				trackId: track.trackId
			},
			{
				where: { contentId: content.contentId }
			});
			res.json(track.trackId);
		});
	});
});

app.route("/tracks/:trackId(\\d+)")
.put(function(req, res)
{
	if(!req.body || !req.body.itemId || !req.body.artist || !req.body.title) return res.status(500).json({ error: true });
	// todo: return error if not logged in
	// todo: return error if not enough trust to submit edits
	Content.count
	({
		where: { trackId: req.params.trackId }
	})
	.then(function(amount)
	{
		// If the track belongs to a single content, it is simply updated, otherwise a new track is created and linked
		// That should prevent erroneous track changes, when the content is linked to mismatching tracks
		if(amount == 1)
		{
			Track.update
			({
				artist: req.body.artist,
				title: req.body.title
			},
			{
				where: { trackId: req.params.trackId }
			})
			.then(function()
			{
				res.json(req.params.trackId);
			});
			return;
		}
		Track.create
		({
			artist: req.body.artist,
			title: req.body.title
		})
		.then(function(track)
		{
			Content.findOne
			({
				attributes: ["contentId"],
				include:
				[{
					model: Item,
					where: { itemId: req.body.itemId }
				}]
			})
			.then(function(content)
			{
				Content.update
				({
					trackId: track.trackId
				},
				{
					where: { contentId: content.contentId }
				});
				res.json(track.trackId);
			});
		});
	});
});

app.route("/items/:itemId(\\d+)")
.delete(function(req, res)
{
	// todo: return error if not logged in
	// todo: include playlist and check user for ownership
	Item.destroy
	({
		where:
		{
			itemId: req.params.itemId
		}
	})
	.then(function(amount)
	{
		if(amount < 1) return res.status(500).json({ error: true });
		res.json([]);
	});
});

app.use(express.static(__dirname + "/public"));
app.use(function(req, res)
{
	res.sendFile("index.html", {root: __dirname + "/public"});
});

sequelize.sync().then(function()
{
	// Newly created contents are assigned to this track
	Track.findOrCreate
	({
		where:
		{
			trackId: -1,
			artist: "Unknown Artist",
			title: "Unknown Track"
		}
	});
	// Normally, a playlist should be created along with the user account
	// Let's make one for testing purposes
	Playlist.findOrCreate
	({
		where:
		{
			playlistId: 1,
			userId: 1,
			name: "Main"
		}
	});
	var server = app.listen(3000, function()
	{
		var port = server.address().port;
		console.log("Raesonic initiated. Selected port: %s.", port);
	});
});