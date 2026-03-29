// xyOps API Layer - Avatar
// Copyright (c) 2019 - 2026 PixlCore LLC
// Released under the BSD 3-Clause License.
// See the LICENSE.md file in this repository.

const fs = require('fs');
const assert = require("assert");
const Path = require('path');
const os = require('os');
const async = require('async');
const resize = require('pixl-resize');
const Tools = require("pixl-tools");

class AvatarManagement {
	
	api_upload_avatar(args, callback) {
		// upload avatar for user
		var self = this;
		if (!this.requireMaster(args, callback)) return;
		if (!this.validateFiles(args, callback)) return;
		
		if (!args.files['file1']) {
			return self.doError('avatar', "No file upload data found in request.", callback);
		}
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			
			var temp_file = args.files['file1'].path;
			var base_path = '/users/' + user.username + '/avatar';
			
			var sizes = [256, 64];
			
			async.eachSeries( sizes,
				function(size, callback) {
					self.resizeStoreImage( temp_file, size, size, base_path + '/' + size + '.png', callback );
				},
				function(err) {
					// all done with all image sizes
					if (err) return self.doError('avatar', err.toString(), callback);
					
					// update user to bump mod date (for cache bust on avatar)
					user.modified = Tools.timeNow(true);
					
					self.logDebug(6, "Updating user", user);
					
					self.storage.put( "users/" + self.usermgr.normalizeUsername(user.username), user, function(err, data) {
						if (err) {
							return self.doError('user', "Failed to update user: " + err, callback);
						}
						
						self.logDebug(6, "Successfully updated user");
						self.logTransaction('user_update', user.username, 
							self.getClientInfo(args, { user: Tools.copyHashRemoveKeys( user, { password: 1, salt: 1 } ) }));
						
						callback({ code: 0 });
					} ); // storage.put
				} // done with images
			); // eachSeries
		} ); // loaded session
	}
	
	api_delete_avatar(args, callback) {
		// delete avatar for user
		var self = this;
		if (!this.requireMaster(args, callback)) return;
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			
			var base_path = '/users/' + user.username + '/avatar';
			var sizes = [256, 64];
			
			async.eachSeries( sizes,
				function(size, callback) {
					self.storage.delete( base_path + '/' + size + '.png', callback );
				},
				function(err) {
					// all done with all image sizes
					if (err) return self.doError('avatar', err.toString(), callback);
					
					// update user to bump mod date (for cache bust on avatar)
					user.modified = Tools.timeNow(true);
					
					self.logDebug(6, "Updating user", user);
					
					self.storage.put( "users/" + self.usermgr.normalizeUsername(user.username), user, function(err, data) {
						if (err) {
							return self.doError('user', "Failed to update user: " + err, callback);
						}
						
						self.logDebug(6, "Successfully updated user");
						self.logTransaction('user_update', user.username, 
							self.getClientInfo(args, { user: Tools.copyHashRemoveKeys( user, { password: 1, salt: 1 } ) }));
						
						callback({ code: 0 });
					} ); // storage.put
				} // done with images
			); // eachSeries
		} ); // loaded session
	}
	
	api_avatar(args, callback) {
		// view avatar for specified user on URI: /api/app/avatar/USERNAME.png
		var self = this;
		var size = parseInt( args.query.size || 256 );
		if (!this.requireMaster(args, callback)) return;
		
		// currently supporting 64px and 256px sizes
		if (size > 64) size = 256;
		else size = 64;
		
		if (!args.request.url.match(/\/avatar\/([\w\-\.]+)\.\w+(\?|$)/)) {
			return self.doError('avatar', "Invalid URL format: " + args.request.url, callback);
		}
		var username = RegExp.$1;
		var storage_key = '/users/' + username + '/avatar/' + size + '.png';
		
		this.storage.getStream( storage_key, function(err, stream) {
			if (err) {
				// use default avatar image instead
				stream = fs.createReadStream('htdocs/images/default.png');
			}
			
			self.setCacheResponse(args, self.config.get('ttl'));
			callback( "200 OK", { "Content-Type": "image/png", }, stream );
		} ); // getStream
	}
	
	resizeStoreImage(source_file, width, height, storage_key, callback) {
		// resize image to fit and store in storage
		var self = this;
		var fmt = Path.extname( storage_key ).replace(/^\./, '');
		if (!fmt) return callback( new Error("Storage key must have an extension: " + storage_key) );
		
		this.logDebug(6, "Resizing image: " + source_file + " to " + width + "x" + height );
		
		fs.readFile( source_file, function(err, in_buf) {
			if (err) return callback(err);
			var out_buf = null;
			
			try { out_buf = resize( in_buf, { width, height, mode: 'cover' } ); }
			catch (err) { return callback(err); }
			
			self.storage.put( storage_key, out_buf, function(err) {
				if (err) return callback(err);
				callback();
			} ); // storage.put
		} ); // fs.readFile
	}
	
}; // class AvatarManagement

module.exports = AvatarManagement;
