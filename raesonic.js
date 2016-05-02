var express = require("express");
var app = express();

var bodyParser = require("body-parser");
var paperwork = require("paperwork");
var config = require("./config.js");

var server;
var controllers = {};

// Create database controller
controllers.Sequelize = require("./server/controllers/SequelizeController.js")(config);
var sequelize = controllers.Sequelize;

// Parse body of json requests
app.use(bodyParser.json());

// Bundle the core components
var core =
{
	app: app,
	sequelize: sequelize,
	paperwork: paperwork,
};

// Create workspace controllers
controllers.Track = require("./server/controllers/TrackController.js")(core);
controllers.Content = require("./server/controllers/ContentController.js")(core);
controllers.Playlist = require("./server/controllers/PlaylistController.js")(core);
controllers.Item = require("./server/controllers/ItemController.js")(core);
controllers.Relation = require("./server/controllers/RelationController.js")(core);
controllers.Search = require("./server/controllers/SearchController.js")(core);

// Allow access to the public files
app.use(express.static(__dirname + "/public"));
app.use(function(req, res)
{
	res.sendFile("index.html", { root: __dirname + "/public" });
});

// Create required database tables
sequelize
	.sync()
	.then(onSequelizeSync);

// Sequelize ready for use
function onSequelizeSync()
{
	var Track = sequelize.models.Track;
	var Playlist = sequelize.models.Playlist;

	// Create a track that newly created content is linked with
	Track.findOrCreate
	({
		where:
		{
			trackId: -1,
			artist: "Unknown Artist",
			title: "Unknown Track"
		}
	})
	.then(function()
	{
		// Playlist should be created along with the user account
		// Let's make one for testing purposes until auth is done
		Playlist.findOrCreate
		({
			where:
			{
				playlistId: 1,
				userId: 1,
				name: "Main"
			}
		});
	});

	server = app.listen(config.server.port, onRaesonicInit);
}

// Application ready for use
function onRaesonicInit()
{
	var port = server.address().port;
	console.log("Raesonic initiated. Selected port: %s.", port);
}
