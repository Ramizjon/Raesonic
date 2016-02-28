var Item = require("./Item.js");

var ItemList = {};

// Set items of the item list
// If useStorage is true and the storage is empty, it is filled with current items
ItemList.setItems = function(items, useStorage)
{
	var storage = $("#items").data("storage") || [];

	if(useStorage && !storage.length)
	{
		$(".item").each(function()
		{
			storage.push($(this).detach());
		});
		$("#items").data("storage", storage);
	}

	$("#items").empty();
	$.each(items, ItemList.addItem);
	$("#items").scrollTop(0);
}

// Add item to the item list
// If the boolean is true, item is added to the beginning
ItemList.addItem = function(itemId, item, prepend)
{
	var Player = require("./Player.js");

	var $item =
		$("<div>")
			.addClass("item")
			.append(
				$("<div>")
					.addClass("artist")
					.html( item[1].replace( /&\+/g, "<span>&</span>" ) )
			)
			.append(
				$("<div>")
					.addClass("title")
					.html( item[2].replace( /\((.+)\)/g, "<span>$1</span>" ) )
			)
			.append(
				$("<div>").addClass("icon add fa fa-plus")
			)
			.data("trackId", item[0]);

	if(item[3])
	{
		$item.data
		({
			"itemId": item[3],
			"sourceId": item[4],
			"externalId": item[5]
		})
		.append(
			$("<div>")
				.addClass("icon edit fa fa-pencil")
				.click(Item.edit)
		);
	}

	$item
		.children()
		.slice(0, 2)
		.click(Player.setItem);

	prepend
		? $("#items").prepend($item)
		: $("#items").append($item);
}

// Scroll to the specified item
ItemList.scrollTo = function($item)
{
	$("#items").animate
	({
		scrollTop:
			Math.max(
				$item.height() * ( $item.siblings(":visible").addBack().index($item) - 1 ),
				0
			)
	}, 500);
}

// Hide items not matching the query
ItemList.setFilter = function(query)
{
	var count = 0;

	$(".item").each(function()
	{
		if(!length)
			return $(this).removeClass("hidden odd even");

		var hidden = true;

		$(this).children().slice(0, 2).each(function()
		{
			if($(this).text().toLowerCase().indexOf(query) != -1) hidden = false;
		});

		$(this)
			.toggleClass("hidden", hidden)
			.removeClass("odd even");

		if(hidden)
			return;

		(count % 2)
			? $(this).addClass("even")
			: $(this).addClass("odd");

		count++;
	});

	$("#items").scrollTop(0);
}

// Clear item filtering and restore previous items
ItemList.clearFilter = function()
{
	$(".item").removeClass("hidden odd even");
	var storage = $("#items").data("storage");

	ItemList.scrollTo( $(".item.active") );

	if(!storage || !storage.length)
		return;

	$("#items").empty();

	storage.forEach(function($item)
	{
		$("#items").append(
			$item.removeClass("hidden odd even active")
		);
	});

	$("#items").data( "storage", [] );
}

module.exports = ItemList;