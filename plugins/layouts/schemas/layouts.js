NEWSCHEMA('Layouts', function(schema) {

	schema.define('id', String);
	schema.define('name', String, true);
	schema.define('icon', 'Icon');
	schema.define('color', 'Color');
	schema.define('html', String);
	schema.define('scripts', '[String]');

	schema.action('list', {
		name: 'Layouts List',
		permissions: 'layouts',
		action: function($) {

			var arr = [];
			for (var item of MAIN.db.layouts)
				arr.push({ id: item.id, name: item.name, icon: item.icon, color: item.color, dtcreated: item.dtcreated, dtupdated: item.dtupdated });

			$.callback(arr);
		}
	});

	schema.action('read', {
		name: 'Read layouts',
		params: '*id:String',
		permissions: 'layouts',
		action: function($) {

			var item = MAIN.db.layouts.findItem('id', $.params.id);
			if (item)
				$.callback(item);
			else
				$.invalid(404);
		}
	});

	schema.action('save', {
		name: 'Save layouts',
		permissions: 'layouts',
		action: function($, model) {
			importwidgets(model, function() {

				var db = MAIN.db;
				var html = model.html;

				delete model.html;

				if (model.id) {

					var item = db.layouts.findItem('id', model.id);
					if (!item) {
						$.invalid(404);
						return;
					}

					item.dtupdated = NOW;
					item.name = model.name;
					item.color = model.color;
					item.icon = model.icon;
					html && db.fs.save(model.id, model.id + '.html', html ? Buffer.from(html, 'utf8') : Buffer.alloc(0), NOOP);
					delete TEMP[item.id];

				} else {
					model.id = UID();
					model.dtcreated = NOW;
					html && db.fs.save(model.id, model.id + '.html', html ? Buffer.from(html, 'utf8') : Buffer.alloc(0), NOOP);
					db.layouts.push(model);
				}

				importnavigation(model, html, function() {
					FUNC.save();
					FUNC.refresh();
					$.success();
					delete MAIN.views[model.id];
				});

			});
		}
	});

	schema.action('import', {
		name: 'Import layouts',
		permissions: 'layouts',
		action: function($, model) {

			var db = MAIN.db;
			var widgets = [];
			var arr = model.html.match(/<widget.*?>/g);
			if (arr) {
				for (var i = 0; i < arr.length; i++) {
					var item = arr[i];
					var index = item.indexOf(' data="');
					if (index !== -1) {
						try {
							var widget = decodeURIComponent(Buffer.from(item.substring(index + 7, item.indexOf('"', index + 8)), 'base64')).toString('utf8');
							widget && widgets.push(widget);
						} catch (e) {}
					}
				}
			}

			model.html = model.html.replace(/<widget.*?>/g, '').trim();
			model.id = UID();
			model.dtcreated = NOW;
			db.fs.save(model.id, model.id + '.html', model.html ? Buffer.from(model.html, 'utf8') : Buffer.alloc(0), $.done());
			delete model.html;
			db.layouts.push(model);

			widgets.wait(function(item, next) {
				EXEC('+Widgets --> save', { html: item }, function(err) {
					err && console.log(err);
					next();
				});
			}, function() {
				FUNC.save();
				$.success();
			});
		}
	});

	schema.action('remove', {
		name: 'Remove layouts',
		params: '*id:String',
		permissions: 'layouts',
		action: function($) {
			var id = $.params.id;
			var index = MAIN.db.layouts.findIndex('id', id);
			if (index !== -1) {
				MAIN.db.layouts.splice(index, 1);
				MAIN.db.fs.remove(id);
				$.success();
				FUNC.refresh();
				FUNC.save();
				delete MAIN.views[id];
			} else
				$.invalid(404);
		}
	});

	schema.action('clone', {
		name: 'Clone layouts',
		params: '*id:String',
		permissions: 'layouts',
		action: function($) {

			var id = $.params.id;
			var db = MAIN.db;
			var model = db.layouts.findItem('id', id);
			if (model) {

				model = CLONE(model);
				model.id = UID();
				model.dtcreated = NOW;
				delete model.dtupdated;
				db.layouts.push(model);

				db.fs.readbuffer(id, function(err, buffer) {
					buffer && db.fs.save(model.id, model.id + '.html', buffer, NOOP);
					$.success(model.id);
					FUNC.save();
				});

			} else
				$.invalid(404);
		}
	});

});

NEWSCHEMA('Layouts/HTML', function(schema) {

	schema.define('id', String, true);
	schema.define('html', String);

	schema.action('read', {
		name: 'Read layouts/HTML',
		params: '*id:String',
		action: function($) {
			var db = MAIN.db;
			var item = db.layouts.findItem('id', $.params.id);
			if (item) {
				db.fs.readbuffer(item.id, function(err, buffer) {
					var obj = {};
					obj.name = item.name;
					obj.html = buffer ? buffer.toString('utf8') : '';
					$.callback(obj);
				});
			} else
				$.invalid(404);
		}
	});

	schema.action('save', {
		name: 'Save layouts/HTML',
		permissions: 'layouts',
		action: function($, model) {

			var db = MAIN.db;
			if (db.layouts.findItem('id', model.id)) {
				importnavigation(model, null, function(err, resave) {

					if (resave)
						FUNC.save();

					importwidgets(model, function() {
						db.fs.save(model.id, model.id + '.html', Buffer.from(model.html, 'utf8'), $.done());
						delete MAIN.views[model.id];
						FUNC.refresh();
					});
				});
			} else
				$.invalid(404);
		}
	});

});

function importnavigation(model, html, callback) {

	if (!html && !model.html) {
		callback(null, false);
		return;
	}

	var index = -1;
	var nav = MAIN.db.nav;
	var refresh = false;

	if (model.html)
		html = model.html;

	while (true) {
		index = html.indexOf(' type="text/navigation"', index);

		if (index === -1)
			break;

		var beg = html.lastIndexOf('<script', index);
		var end = html.indexOf('</script>', index);

		var scr = html.substring(beg, html.indexOf('>', index));
		var name = scr.match(/name=".*?"/i)[0];

		name = name.substring(6, name.length - 1);

		var id = HASH(name).toString(36);
		var item = nav.findItem('id', id);

		if (!item) {
			nav.push({ id: id, name: name, dtcreated: NOW, children: [] });
			refresh = true;
		}

		index = end;
	}

	callback(null, refresh);

}

function importwidgets(model, callback) {

	var widgets = [];
	var arr = model.html.match(/<widget.*?>/g);
	if (arr) {
		for (var i = 0; i < arr.length; i++) {
			var item = arr[i];
			var index = item.indexOf(' data="');
			if (index !== -1) {
				try {
					var widget = decodeURIComponent(Buffer.from(item.substring(index + 7, item.indexOf('"', index + 8)), 'base64')).toString('utf8');
					widget && widgets.push(widget);
				} catch (e) {}
			}
		}
	}

	model.html = model.html.replace(/<widget.*?>/g, '').trim();

	widgets.wait(function(item, next) {
		EXEC('+Widgets --> save', { html: item, singleton: true }, function(err) {
			err && console.log(err);
			next();
		});
	}, callback);

}