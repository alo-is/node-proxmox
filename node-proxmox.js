module.exports = function ProxmoxApi(hostname, user, pve, password){
	// INIT vars
    this.hostname = hostname;
    this.user = user;
    this.password = pve;
    this.pve = password;
    this.token = {};
    this.tokenTimestamp = 0;

    function login(hostname, user, pve, password, callback)
	{		
		var querystring = require('querystring');
		body = { password: password, username: user, realm: pve };
		body = querystring.stringify(body);
		var headers = {
			'Content-Type':'application/x-www-form-urlencoded',
			'Content-Length': Buffer.byteLength(body)
		};
		var options = {
			host: hostname,
			rejectUnauthorized: false, //Allow unauthorized SSL certificate
			port: 8006,
			path: '/api2/json/access/ticket',
			method: 'POST',
			headers: headers
		};
		var http = require('https');
		var par = this;
		var req = http.request(options, function(res){
			res.setEncoding('utf8');
		    res.on('data', function (chunk) {
		    	//Error handling to do
		    	var data = JSON.parse(chunk).data;
		        par.token = {ticket: data.ticket, CSRFPreventionToken: data.CSRFPreventionToken};
		    	par.tokenTimestamp = new Date().getTime();	
		    	if(callback != undefined)
		    		callback();
		    });
		});
		req.write(body);
		req.end();
	}

	function call(method, url, body, callback)
	{
		currentTime = new Date().getTime();
		//1 hour login timeout
		if(currentTime - this.tokenTimestamp > 60 * 60 * 1000)
		{
			login(this.hostname, this.user, this.password, this.pve, function(){callApi(method, url, body, callback);});
		}
		else
		{
			callApi(method, url, body, callback);
		}
	}

	function callApi(method, url, body, callback)
	{
		var currentTime = new Date().getTime();	
		
		var querystring = require('querystring');

		//Compute signature
		if(body == undefined)
			body = '';
		else
			body = querystring.stringify(body);

		if(method == 'GET')
		{
			var headers = {
				'Cookie':'PVEAuthCookie='+this.token.ticket
			};
		}
		else {
			var headers = {
				'Content-Type':'application/x-www-form-urlencoded',
				'Content-Length': Buffer.byteLength(body),
				'CSRFPreventionToken':this.token.CSRFPreventionToken,
				'Cookie':'PVEAuthCookie='+this.token.ticket
			};
		}

		var options = {
			host: this.hostname,
			rejectUnauthorized: false,
			port: 8006,
			path: '/api2/json'+url,
			method: method,
			headers: headers
		};

		var http = require('https');

		var req = http.request(options, function(res){
			res.setEncoding('utf8');
			var data = '';
		    res.on('data', function (chunk) {
		        data += chunk;
		    });
		    res.on('end', function(){
				var dataa = JSON.parse(data).data;
		        if(callback != undefined)
		        	callback(dataa);
			});
		});

		if(body != '')
			req.write(querystring.stringify(body));
		req.end();

	}

return {
		get: function get(url, callback){
			call('GET', url, '', callback);
		},
		post: function post(url, body, callback){
			call('POST', url, body, callback);
		},
		put: function put(url, body, callback){
			call('PUT', url, body, callback);
		},
		del: function del(url, callback){
			call('DELETE', url, '', callback);
		},
	}
}