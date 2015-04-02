/**
 * mongoose_rpc
 * @module mongoose_rpc
 */

// Include the events library so we can extend the EventEmitter
// class. This will allow our evented cache to emit() events.
var EventEmitter = require("events").EventEmitter

var uuid = require('node-uuid')


var schemaDesign = {
	//ts:   { type: Date, default: Date.now },
	from: String,
	to: {
		type: String,
		default: '*'
	},
	ttl: {
		type: Date,
		default: function() {
			Date.now + 1000
		}
	}, // Messages will be relevent 1000 ms
	fn: String,
	args: Array,
	cb: String
}

/** MongooseRPC. */
function MongooseRPC(mongoose, collection, name, matchregex, context, capped_size, remove_old_cb_time) {
	if (!capped_size) {
		capped_size = 10000000 // 10MB
	}
	if (!collection instanceof String) {
		throw new Error('MongooseRPC expects argument1 collection to be a String.')
	}

	if (!remove_old_cb_time) {
		remove_old_cb_time = 10000 // Every 10 Seconds
	}

	this._remove_old_cb_time = remove_old_cb_time

	this._name = name || 'Main'

	this._context = {}
	this._callbacks = {}

	this._qry = null
	this._remove_old_cb_timer = null

	this.setMatchRegex(matchregex)

	var schema = new mongoose.Schema(schemaDesign, {
		capped: capped_size
	})

	var self = this
	schema.methods.expandTTL = function MongooseRPC_Model_expandTTL(ms) {
		if (ms !== undefined && isNaN(ms)) {
			throw new Error('MongooseRPC_Model_expandTTL expects parameter ms to be a number.')
		}

		if (!ms || ms < 0) {
			ms = 10000 // Defaults to adding 10 seconds to the cb ttl
		}


		if (!this.ttl instanceof Date) {
			this.ttl = new Date(this.ttl || Date.now())
		}
		this.ttl += ms

		// no point sending a request to expandTTL of a cb if no cb action set.
		// or if the from is the same name
		if (!this.cb || this.from === self.name) {
			return
		}

		self.send('#cb_ttl_extend', [this.ttl], this.from, this.cb)
	}

	// Array.prototype.slice.call(arguments) Gets us arguments as an array as its a special kind of object similar to an array otherwise.
	schema.methods.result = function MongooseRPC_Model_result() {
		if (!this.cb || this.from === self.name) {
			return
		}

		this._replied_to = true
		if (arguments.length === 1 && arguments[0] === this.args) {
			self.send('#cb', this.args, this.from, this.cb)
		} else {
			self.send('#cb', Array.prototype.slice.call(arguments), this.from, this.cb)
		}
	}
	schema.methods.reply = schema.methods.result

	schema.methods.error = function MongooseRPC_Model_error() {
		this.emit("error", 'Function ' + this.fn + ' ' + this.from + ' Error ' + arguments.toString())
		if (!this.cb || this.from === self.name) {
			return
		}

		this._replied_to = true
		self.send('#cb_error', Array.prototype.slice.call(arguments), this.from, this.cb)
	}

	// A virtual data returned when reading gets the timestamp from the id.
	schema.virtual('created').get(function() {
		if (this["_created"]) return this["_created"]
		return this["_created"] = this._id.getTimestamp()
	})

	this._model = mongoose.model(collection + '_' + name, schema, collection)

	if (context) {
		this.context(context)
	}

	// Return this object reference.
	return (this)
}

// Extend the event emitter class so that we can use on() and emit()
MongooseRPC.prototype = Object.create(EventEmitter.prototype)

MongooseRPC.prototype._remove_old_cb = function MongooseRPC__remove_old_cb() {
	var keys = Object.keys(this._context)
	for (var i = 0; i < keys.length; i++) {
		//console.log('remove_old_cb for '+keys[i]+' ttl is '+this._context[keys[i]].m.ttl+' Date.now is '+Date.now())
		if (this._context[keys[i]].m.ttl < Date.now()) {
			if (this._context[keys[i]].count === 0) {
				this.emit("warning", 'Unhandled Callback for ' + m.fn + ' to ' + m.to + '.')
			}
			delete this._context[keys[i]]
		}
	}
}

MongooseRPC.prototype._process_rpc = function MongooseRPC__process_rpc(doc) {
	// Ignore messages that are too old. Should this send off an event?
	if (doc.ttl < Date.now()) {
		this.emit("warning", 'Old message "' + doc.fn + '" from ' + doc.from + ' ignored as it is too old.')
		return
	}

	if (doc.fn.charAt(0) == '#') {
		switch (doc.fn) {
			case '#list':
				doc.result(Object.keys(this._context))
				break
			case '#rpc_started':
				this.emit("started", doc.from)
				break
			case '#rpc_stopped':
				this.emit("stopped", doc.from)
				break
			case '#cb_ttl_extend':
				var cb = this._callbacks[doc.cb]
				if (!cb) {
					this.emit("warning", 'Callback "' + doc.cb + '" not found.')
					return
				}
				var ttl = doc.args[0]
				if (cb.ttl < ttl) {
					cb.ttl = ttl
					this.emit("extension", {
						from: doc.from,
						cb: cb
					})
				}
				break
			case '#ping':
				this.emit("pinged", doc.from)
				doc.result(doc.args)
				break
			case '#fn_not_exposed':
			case '#cb_error':
			case '#cb':
				var cb = this._callbacks[doc.cb]
				if (cb) {
					try {
						var args = doc.args
						if (doc.fn === '#cb') {
							args = [null].concat(args)
						}

						if (doc.fn !== '#fn_not_exposed') {
							cb.count++
						} else {
							this.emit("warning", 'Function not exposed: ' + doc.fn + ' On: ' + doc.from)
						}

						cb.fn.apply({
							m: cb.m,
							doc: doc
						}, args)
					} catch (err) {
						this.emit("error", 'MongooseRPC callback exception: ' + err + ' on ' + this._name + ' calling ' + cb.m.fn + ' on ' + cb.m.to + ' reply from ' + doc.from)
					}
				} else {
					this.emit("warning", 'Callback not found: ' + doc.cb + ' From: ' + doc.from)
				}
				break
			default:
				this.emit("warning", 'MongooseRPC unhandled special function: ' + doc.fn + ' has been ignored.\nReminder do not have your functions prefixed with # as those should be reserved for MongoseRPC internals.')
				break
		}
		return
	} else {
		var fn = this._context[doc.fn]
		if (!fn) {
			this.emit("warning", 'Function not exposed: ' + doc.fn + ' From: ' + doc.from)
			if (doc.cb) {
				this.send('#fn_not_exposed', [doc.fn + ' is not not exposed on ' + this._name], doc.from, doc.cb)
			}
			return
		}

		try {
			var result = fn.apply(doc, doc.args)
			if (doc._replied_to === undefined) {
				doc.result(result)
			}
		} catch (err) {
			doc.error(err)
		}
	}
}

/**
 * Used to set a regex match for finding messages to the receiver
 * @example <caption>Match only LOG.</caption>
 * RPC.setMatchRegex(/^LOG$/)
 */
MongooseRPC.prototype.setMatchRegex = function MongooseRPC_setMatchRegex(matchregex) {
	if (matchregex instanceof RegExp) {
		this._matchregex = matchregex
		return
	}

	if (matchregex instanceof String) {
		this._matchregex = new RegExp(matchregex)
		return
	}

	var nameSegments = this._name.split('.')
	var namepartial = ''
	var regexString = '(^' + this._name + '$)|'
	for (var i = 0; i < nameSegments.length - 1; i++) {
		namepartial += nameSegments[i] + '\\.'
		regexString += '(^' + namepartial + '\\*$)|'
	}
	regexString += '(^' + this._name.substr(0, 1) + '\\*$)|'
	regexString += '(^\\*$)'

	this._matchregex = new RegExp(regexString, 'm')
}

/**
 * Used to ping other receivers and get the latency in ms.
 * @example <caption>Example usage of context.</caption>
 * RPC.ping('Main', console.log)
 */
MongooseRPC.prototype.ping = function MongooseRPC_ping(to, cb) {
	if (typeof(to) === 'function' && cb === undefined) {
		cb = to
		to = '*'
	}

	if (typeof(cb) !== 'function' && cb !== undefined) {
		throw new Error('MongooseRPC_ping expects callback argument to be a function.')
	}

	var startTimestamp

		function onPingReply(err, result) {
			var latency = Date.now() - startTimestamp
			if (cb) {
				cb(latency, this.doc.from)
			} else {
				console.log('Ping to '+this.doc.from+' took '+latency+' ms.');
			}
		}

	startTimestamp = Date.now()
	this.send('#ping', onPingReply, to)
}

/**
 * Used to set a context object completely.
 * @example <caption>Example usage of context.</caption>
 * RPC.context({ test: function() { console.log(arguments); } })
 */
MongooseRPC.prototype.context = function MongooseRPC_context(context) {
	// TODO: Handle array etc
	this._context = context
}

/**
 * Used to expose a function to RPC.
 * @example <caption>Example usage of expose.</caption>
 * RPC.context(function Name(){ console.log('Yay'); })
 * RPC.context('Name', function(){ console.log('Yay'); })
 */
MongooseRPC.prototype.expose = function MongooseRPC_expose() {
	var fn
	var name
	if (arguments.length == 1 && typeof(arguments[0]) === 'function') {
		fn = arguments[0]
		name = fn.name
	} else if (arguments.length === 2 && arguments[0] instanceof String && typeof(arguments[1]) === 'function') {
		name = arguments[0]
		fn = arguments[1]
	} else {
		throw new Error('MongooseRPC_expose expects either a named function or a string for the name and a function as arguments.')
	}

	if (name === "" || name === null) {
		throw new Error('MongooseRPC_expose expects name to be set.')
	}

	// If the context already has a function we are overriding.
	// if (!this._context[name]) {
	//
	// }

	this._context[name] = fn
}

/**
 * Used to remove a function from being available to RPC.
 * @example <caption>Example usage of conceal.</caption>
 * RPC.conceal('Name')
 */
MongooseRPC.prototype.conceal = function MongooseRPC_conceal(name) {
	delete this._context[name]
}

/**
 * Used to stop the listening to requests.
 */
MongooseRPC.prototype.stop = function MongooseRPC_stop() {
	if (this._qry == null) {
		return
	}

	// Disconnect/Stop query.
	this._qry.destroy()
	this._qry = null
	clearInterval(this._remove_old_cb_timer)

	this.emit("stopped", this._name)
	this.send('#rpc_stopped')
}

MongooseRPC.prototype.isStarted = function MongooseRPC_isStarted() {
	return !!this._qry
}

MongooseRPC.prototype._startQuery = function MongooseRPC__startQuery() {
	return this._model.find().where('from').ne(this._name).regex('to', this._matchregex).where('ttl').gte(Date.now()).tailable().stream()
}

/**
 * Used to start listening for requests.
 */
MongooseRPC.prototype.start = function MongooseRPC_start() {
	if (this._qry) {
		return
	}

	this.emit("started", this._name)
	this.send('#rpc_started')

	// Connect / Start query.
	this._qry = this._startQuery()

	var self = this
	this._qry.on('data', function MongooseRPC_TailRecv(doc) {
		self._process_rpc(doc)
	}).on('error', function MongooseRPC_TailError(err) {
		this.emit("error", err)
		self.stop()
	}).on('close', function MongooseRPC_TailClose(err) {
		this.emit("warning", err)
		self.stop()
	})

	var self = this
	this._remove_old_cb_timer = setInterval(function() {
		self._remove_old_cb
	}, this._remove_old_cb_time)
}

/**
 * Restarts listening for requests.
 */
MongooseRPC.prototype.restart = function MongooseRPC_restart() {
	this.stop()
	this.start()
}

/**
 * Pauses stream.
 */
MongooseRPC.prototype.pause = function MongooseRPC_pause() {
	if (this._qry) {
		this._qry.pause()
	}

	clearInterval(this._remove_old_cb_timer)
}

/**
 * resumes stream.
 */
MongooseRPC.prototype.resume = function MongooseRPC_resume() {
	if (this._qry) {
		this._qry.resume()
	}

	var self = this
	this._remove_old_cb_timer = setInterval(function() {
		self._remove_old_cb
	}, this._remove_old_cb_time)
}

/**
 * Writes an RPC request to the mongo db capped collection.
 * @example <caption>Example usage of send.</caption>
 * RPC.setAccess('FunctionName',[arguments]) // Requests all listeners to execute FunctionName if possible
 * ttl is in miliseconds and defaults to 500
 */
MongooseRPC.prototype.send = function MongooseRPC_send(fn, args, to, cb, ttl) {
	// Handle case where cb might be ttl
	if (!isNaN(cb) && ttl === undefined) {
		ttl = cb
	}

	if (ttl == 0) {
		ttl = null
	}

	// Handle case if to is actually the callback
	if (typeof(to) === 'function' && cb === undefined) {
		cb = to
		to = '*'
	}

	if (typeof(args) === 'function' && cb === undefined) {
		cb = args
		args = []
	}

	if (ttl === undefined) {
		ttl = 500
	}

	if (to === undefined || to === undefined) {
		to = '*'
	}

	if (!fn instanceof String) {
		throw new Error('MongooseRPC_send expects fn to be a String.')
	}

	if ((!Array.isArray(args)) && (args !== undefined && args !== null)) {
		args = [args]
	}

	if ((!typeof(cb) === 'function') && cb !== null) {
		throw new Error('MongooseRPC_send expects callback to be a function or null.')
	}

	// Generate cb_id if there is a cb
	var cb_id = null

	if (fn === '#cb_ttl_extend' || fn === '#cb' || fn === '#cb_error') {
		cb_id = cb // For our special functions we want to pass cb as what its identifier is
	} else {
		if (cb) {
			cb_id = uuid.v1() // TODO: Should we be using v4 uuid?
		}
	}

	to = to.split(',').join('\n')

	var d = {
		fn: fn,
		args: args,
		from: this._name,
		to: to,
		cb: cb_id,
		ttl: Date.now() + ttl
	}

	var m = new this._model(d)

	if (cb_id !== null) {
		this._callbacks[cb_id] = {
			fn: cb,
			m: m,
			count: 0
		}
	}

	if (this.send_errors) {
		var self = this
		m.save(function(err) {
			if (err) {
				this.emit("error", err)
				return
			}
		})
	} else {
		m.save()
	}
}

module.exports = exports = MongooseRPC