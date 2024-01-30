/*!
 * NodePing
 * Copyright(c) 2020 NodePing LLC
 */

/*!
 * check_httpadv.js
 * http advance check.
 */

/**
 *  static config.
 **/
var config = {
    debug: false,              // whether we're showing debug messages
    timeout:10000              // Can be overriden by a parameter
};

var resultobj = require('../results.js');
var sys = require('util');
var querystring = require("querystring");
var logger = console;
var nputil = require("../../nputil");
var url = require('url');
var zlib = require('zlib');
var dns = require('dns');
var net = require('net');

var check = function(jobinfo, retry){
//logger.log('info',"check_httpadv: jobinfo: "+sys.inspect(jobinfo));
    var defaulttimeout = config.timeout * 1;
    var timeout = config.timeout * 1;
    if(jobinfo.parameters.threshold){
        defaulttimeout = 1000 * parseInt(jobinfo.parameters.threshold);
        if (defaulttimeout > 90000) defaulttimeout = 90000;
        timeout = defaulttimeout + 2000;
    }
    var debugMessage = function (messageType, message){
        if(jobinfo.debug || config.debug){
            logger.log(messageType,message);
        }
    };
    debugMessage('info',"check_httpadvanced: Jobinfo passed to http advanced check: "+sys.inspect(jobinfo));
    if (!retry && jobinfo.targetip) {
        delete jobinfo.targetip;
    }
    jobinfo.results = {start:new Date().getTime()};
    if (jobinfo.redirectstart) {
        // Set start from before the redirect
        jobinfo.results.start =  jobinfo.redirectstart;
    }
    jobinfo.results.message = '';

    var statuscode = false;
    if (jobinfo.parameters.statuscode) {
        var statuscode = parseInt(jobinfo.parameters.statuscode);
        if (statuscode < 1 || statuscode >1000 ) {
            statuscode =  false;
        }
    }

    var headersToSend = false;
    if (jobinfo.parameters.sendheaders && typeof jobinfo.parameters.sendheaders == 'object') {
        headersToSend = jobinfo.parameters.sendheaders;
    }

    var receiveheaders = false;
    if (jobinfo.parameters.receiveheaders && typeof jobinfo.parameters.receiveheaders == 'object') {
        //debugMessage('info',"check_httpadv: Setting receiveheaders to: "+sys.inspect(jobinfo.parameters.receiveheaders));
        receiveheaders = jobinfo.parameters.receiveheaders;
    }

    var dataToSend = '';
    if (jobinfo.parameters.data && typeof jobinfo.parameters.data == 'object' && !nputil.isEmptyObject(jobinfo.parameters.data)) {
        dataToSend = querystring.stringify(jobinfo.parameters.data);
    } else if (jobinfo.parameters.postdata && !nputil.isEmptyObject(jobinfo.parameters.postdata) && jobinfo.parameters.postdata !== '') {
        //logger.log('info',"check_httpadv: dataToSend: "+sys.inspect(jobinfo.parameters.postdata));
        dataToSend = jobinfo.parameters.postdata; //.replace('/"','"', 'g');
    }
    debugMessage('info',"check_httpadv: dataToSend for "+jobinfo._id+" after munge: "+sys.inspect(dataToSend));

    var httpMethod = 'get';
    if (jobinfo.parameters.method && ['get','post','put','head','delete','trace','connect'].indexOf(jobinfo.parameters.method.toLowerCase()) > -1) {
        httpMethod = jobinfo.parameters.method.toLowerCase();
    }

    if(!jobinfo.parameters.target){
        //logger.log('info',"check_httpcontent: Invalid URL");
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid URL';
        resultobj.process(jobinfo, true);
        return true;
    }else{
        var thetarget = jobinfo.redirecttarget || jobinfo.parameters.target;
        try{
            var targetinfo = url.parse(thetarget);
        }catch(error){
            //logger.log('info',"check_httpcontent: Invalid URL");
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.success = false;
            jobinfo.results.statusCode = 'error';
            jobinfo.results.message = 'URL will not parse: '+error;
            resultobj.process(jobinfo, true);
            return true;
        }
        var tryIpv6 =  function(){
            jobinfo.dnsresolutionstart = new Date().getTime();
            dns.resolve6(targetinfo.hostname, function (err, addresses) {
                jobinfo.dnsresolutionend = new Date().getTime();
                if (err) {
                    jobinfo.results.success = false;
                    jobinfo.results.end = new Date().getTime();jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = 'Error';
                    jobinfo.results.message = 'Error resolving '+targetinfo.hostname;
                    if (err.code === 'ENODATA') {
                        jobinfo.results.message = 'No addresses found for '+targetinfo.hostname;
                    } else if (err.code === 'ENOTFOUND') {
                        jobinfo.results.message = 'No DNS resolution for '+targetinfo.hostname;
                    }
                    resultobj.process(jobinfo);
                } else if(addresses && addresses[0]) {
                    jobinfo.targetip = addresses[0];
                    return check(jobinfo, true);
                } else { // no resolution - empty array returned.
                    jobinfo.results.success = false;
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = 'Error';
                    jobinfo.results.message = 'No DNS addresses found for '+targetinfo.hostname;
                    resultobj.process(jobinfo);
                }
                return true;
            });
            return true;
        };
        if (!jobinfo.targetip) {
            if (jobinfo.parameters.ipv6) {
                if (!net.isIPv6(targetinfo.hostname)) {
                    return tryIpv6();
                }
            } else {
                // Resolve the ipv4
                if (!net.isIPv4(targetinfo.hostname) && !net.isIPv6(targetinfo.hostname)) {
                    jobinfo.dnsresolutionstart = new Date().getTime();
                    dns.resolve4(targetinfo.hostname, function (err, addresses) {
                        jobinfo.dnsresolutionend = new Date().getTime();
                        if (err) {
                            //logger.log('info','check_httpadv: resolution error: '+sys.inspect(err));
                            //logger.log('info','check_httpadv: resolution addresses: '+sys.inspect(addresses));
                            if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') {
                                return tryIpv6();
                            }
                            jobinfo.results.success = false;
                            jobinfo.results.end = new Date().getTime();
                            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                            jobinfo.results.statusCode = 'Error';
                            jobinfo.results.message = 'Error resolving the hostname: '+targetinfo.hostname;
                            resultobj.process(jobinfo);
                        } else if(addresses && addresses.length && addresses[0]) {
                            //logger.log('info','check_http: resolution addresses: '+sys.inspect(addresses));
                            if (addresses[0]) {
                                jobinfo.targetip = addresses[0];
                                return check(jobinfo, true);
                            }
                        } else { // no ipv4 resolution - empty array returned.
                            return tryIpv6();
                        }
                        return true;
                    });
                    return true;
                }
            }
        } else {
            targetinfo.hostname = jobinfo.targetip;
        }
        var agent;
        if(targetinfo.protocol){
            if(targetinfo.protocol == 'http:'){
                agent = require('http');
                //logger.log('info',"check_http: Using http");
            }else if (targetinfo.protocol == 'https:'){
                agent = require('https');
                //logger.log('info',"check_http: Using https");
            }else{
                //logger.log('info',"check_httpcontent: Invalid protocol: "+targetinfo.protocol);
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.success = false;
                jobinfo.results.statusCode = 'error';
                jobinfo.results.message = 'Invalid protocol';
                resultobj.process(jobinfo, true);
                return true;
            }
        }else {
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.success = false;
            jobinfo.results.statusCode = 'error';
            jobinfo.results.message = 'Invalid URL';
            resultobj.process(jobinfo, true);
            return true;
        }

        var sendheaders = {'Accept': '*/*',
                           'User-Agent': 'NodePing'};
        if (targetinfo.host) {
            sendheaders['Host'] = targetinfo.host;
        }
        if (dataToSend.length) {
            sendheaders['Content-Type'] = 'application/x-www-form-urlencoded';
            sendheaders['Content-Length'] = dataToSend.length;
        }
        var sendheaderslower = {};
        for (var he in sendheaders) {
            if (sendheaders[he]) {
                sendheaderslower[he.toLowerCase()] = he;
            }
        }
        if (headersToSend) {
            for (var h in headersToSend) {
                if (headersToSend[h]) {
                    var hlower = h.toLowerCase();
                    if (sendheaderslower[hlower]) {
                        delete(sendheaders[sendheaderslower[hlower]]);
                    }
                    sendheaders[h] = headersToSend[h];
                }
            }
        }
        debugMessage('info',"check_httpadv: headersToSend for "+jobinfo._id+": "+sys.inspect(headersToSend));
        // Auth
        if(targetinfo.auth){
            sendheaders.Authorization = 'Basic ' + new Buffer(targetinfo.auth).toString('base64');
        }
        var targetoptions = {host:targetinfo.hostname,
                             method:httpMethod,
                             headers: sendheaders,
                             rejectUnauthorized: false};

        if(targetinfo.port){
            targetoptions.port = targetinfo.port;
        }

        if(targetinfo.pathname){
            if(targetinfo.search){
                targetoptions.path = targetinfo.pathname+targetinfo.search;
            }else{
                targetoptions.path = targetinfo.pathname;
            }
        }

        targetinfo.agent = false;
        debugMessage('info',"check_httpadv: targetoptions for "+jobinfo._id+": "+sys.inspect(targetoptions));
        debugMessage('info','check_httpadv: targetip is: '+sys.inspect(jobinfo.targetip));
        var killit = false;
        var lookForContent = function(jobinfo, body){
            debugMessage('info',"check_httpadv: body returned is: "+sys.inspect(body));
            var foundit = false;
            if (jobinfo.parameters.regex) {
                debugMessage('info',"check_httpadv: Looking for regex: "+jobinfo.parameters.contentstring);
                var rg = new RegExp(jobinfo.parameters.contentstring);
                foundit = rg.test(body);
            } else {
                foundit = body.indexOf(jobinfo.parameters.contentstring);
                if (foundit < 0) {
                    foundit = false;
                } else {
                    foundit = true;
                }
            }
            if(!foundit){
                if(jobinfo.parameters.invert){
                    //logger.log('info','check_httpadv: We found '+jobinfo.parameters.contentstring+' in the body of : '+jobinfo.parameters.target);
                    jobinfo.results.success = true;
                    jobinfo.results.message = 'Success';
                    resultobj.process(jobinfo);
                }else{
                    //logger.log('info','check_httpadv: We did not find '+jobinfo.parameters.contentstring+' in the body of : '+jobinfo.parameters.target);
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'Not found';
                    resultobj.process(jobinfo);
                }
            }else{
                debugMessage('info',"check_httpadv: found content or regex: "+jobinfo.parameters.contentstring);
                if(jobinfo.parameters.invert){
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'Found';
                    resultobj.process(jobinfo);
                }else{
                    //logger.log('info','check_httpadv: We found '+jobinfo.parameters.contentstring+' in the body of : '+jobinfo.parameters.target);
                    jobinfo.results.success = true;
                    jobinfo.results.message = 'Success';
                    resultobj.process(jobinfo);
                }
            }
            return true;
        };
        try{
            var timeoutid = setTimeout(function() {
                if(killit){
                    return true;
                }
                killit = true;
                req.abort();
                debugMessage('info',"check_httpadv: settimeout called for "+jobinfo._id+": "+sys.inspect(timeout));
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Timeout';
                jobinfo.results.success = false;
                jobinfo.results.message = 'Timeout';
                resultobj.process(jobinfo);

                return true;
            }, timeout);
            var req = agent.request(targetoptions, function(res){
                var body = '';
                var chunks = [];
                var timeoutid = timeoutid;
                //debugMessage('info',"check_httpadv: res inside "+jobinfo._id+": "+sys.inspect(res));
                //res.setEncoding('utf8');
                res.connection.on('error', function (err) {
                    if(killit){
                        return true;
                    }
                    killit = true;
                    if (req) {
                        req.abort();
                    }
                    debugMessage('info',"check_httpadv: res error "+jobinfo._id+": "+sys.inspect(err));
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = 'Error';
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'connection error';
                    resultobj.process(jobinfo);
                    return true;
                });
                res.on('data', function(d) {
                    //debugMessage('info',"check_httpadv: res data "+jobinfo._id+": "+sys.inspect(d));
                    body += d.toString('utf8');
                    if (res.headers['content-encoding'] && (res.headers['content-encoding'] === 'gzip' || res.headers['content-encoding'] === 'deflate')){
                        // Save these buffer chunks for later in case we need to decompress the reply.
                        chunks.push(d);
                    }
                    if(body.length > 3145728){// 3MB limit
                        clearTimeout(timeoutid);
                        killit = true;
                        req.abort();
                        //logger.log('info','check_httpcontent: Response has ended and total body is: '+sys.inspect(body));
                        jobinfo.results.end = new Date().getTime();
                        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                        jobinfo.results.statusCode = 413;
                        jobinfo.results.success = false;
                        jobinfo.results.message = '3MB file size exceeded';
                        resultobj.process(jobinfo);
                        return true;
                    }
                });
                res.on('end', function(){
                    debugMessage('info',"check_httpadv: res end called for "+jobinfo._id);
                    if(!killit){
                        clearTimeout(timeoutid);
                        killit = true;
                        //logger.log('info','check_httpcontent: Response has ended and total body is: '+sys.inspect(body));
                        jobinfo.results.end = new Date().getTime();
                        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                        jobinfo.results.success = true;
                        jobinfo.results.diag = {"http":{requestheaders:targetoptions.headers,
                                                        responseheaders:res.headers,
                                                        httpstatus:res.statusCode,
                                                        httpserverip:req.connection.remoteAddress}
                                               };
                        // Did it take too long?
                        if(defaulttimeout < jobinfo.results.runtime){
                            //logger.log('info','check_httpcontent: Timeout: '+sys.inspect(defaulttimeout)+" is less than "+sys.inspect(jobinfo.results.runtime));
                            jobinfo.results.success = false;
                            jobinfo.results.message = 'Timeout';
                            jobinfo.results.statusCode = 'Timeout';
                            resultobj.process(jobinfo);
                            return true;
                        }
                        
                        // Check status code
                        jobinfo.results.statusCode = res.statusCode;
                        jobinfo.results.message = '';
                        if (statuscode) {
                            if (statuscode != res.statusCode) {
                                jobinfo.results.success = false;
                                jobinfo.results.message = 'HTTP status received: '+res.statusCode.toString()+' expected: '+statuscode.toString();
                            }
                        } else if(res.statusCode <200 || res.statusCode > 399){
                            // Status code out of range.
                            jobinfo.results.success = false;
                            jobinfo.results.message = 'HTTP status returned: '+res.statusCode.toString();
                        }
                        if(httpMethod == 'get' && jobinfo.parameters.follow && res.statusCode >=300 && res.statusCode < 399){
                            // Have we redirected too many times already?
                            if (jobinfo.redirectcount && jobinfo.redirectcount > 4) {
                                // Too many redirects.
                                jobinfo.results.success = false;
                                jobinfo.results.message = 'Too many redirects';
                                resultobj.process(jobinfo);
                                return false;
                            } else {
                                delete jobinfo.targetip;
                                if (!jobinfo.redirectcount){
                                    jobinfo.redirectcount = 1;
                                } else {
                                    jobinfo.redirectcount = jobinfo.redirectcount + 1;
                                }
                                // Set the new redirecttarget and try again.
                                debugMessage('info',"check_httpadvanced: redirect header says "+sys.inspect(req.res.headers.location));
                                var redirect = req.res.headers.location;
                                if (redirect.indexOf('https:') === 0 || redirect.indexOf('http:') === 0 || redirect.indexOf('HTTP:') === 0 || redirect.indexOf('HTTPS:') === 0) {
                                    // Absolute redirect.
                                } else {
                                    // relative redirect - need to get the right base url (either parameters.target or a previous redirect target)
                                    thetarget = jobinfo.redirecttarget || jobinfo.parameters.target;
                                    targetinfo = url.parse(thetarget);
                                    if (redirect.indexOf('/') === 0) {
                                        // Replace the whole pathname
                                        var toreplace = targetinfo.pathname;
                                        if (targetinfo.search){
                                            toreplace = toreplace + targetinfo.search;
                                        }
                                        debugMessage('info',"check_httpadvanced: Going to replace: "+sys.inspect(toreplace)+" with "+sys.inspect(redirect));
                                        var pos = targetinfo.href.lastIndexOf(toreplace);
                                        if (pos > 7) {
                                            redirect = targetinfo.href.substring(0, pos) + redirect;
                                        } else {
                                            logger.log('error',"check_httpadvanced: Weird placement for the last instance of: "+sys.inspect(toreplace)+" in "+sys.inspect(redirect)+' for check '+jobinfo.jobid);
                                        }
                                    } else {
                                        // tack this redirect on the end of the current path - removing the search, if any.
                                        if (targetinfo.pathname.slice(-1) !== '/'){
                                            // strip off the last filename if any.
                                            var pos = targetinfo.href.lastIndexOf('/');
                                            if (pos > 7) {
                                                targetinfo.href = targetinfo.href.substring(0, pos);
                                            }
                                            redirect = '/'+redirect;
                                        }
                                        if (targetinfo.search) {
                                            targetinfo.href = targetinfo.href.replace(targetinfo.search,'');
                                        }
                                        redirect = targetinfo.href+redirect;
                                    }
                                }
                                jobinfo.redirecttarget = redirect;
                                jobinfo.redirectstart = jobinfo.results.start; 
                                req.abort();
                                return check(jobinfo);
                            }
                        } 
                        // Check headers
                        if (receiveheaders) {
                            debugMessage('info',"check_httpadv: received headers: "+sys.inspect(res.headers));
                            //debugMessage('info',"check_httpadv: headers I'm looking for: "+sys.inspect(receiveheaders));
                            for (var head in receiveheaders) {
                                //debugMessage('info',"check_httpadv: Looking for header: "+sys.inspect(head));
                                var headLowered = head.toLowerCase();
                                //debugMessage('info',"check_httpadv: Looking for header: "+sys.inspect(headLowered));
                                //debugMessage('info',"check_httpadv: type for "+sys.inspect(res.headers[headLowered])+": "+nputil.gettype(res.headers[headLowered]));
                                if (!res.headers[headLowered]) {
                                    jobinfo.results.success = false;
                                    jobinfo.results.message += ' HTTP header missing: '+head+'. ';
                                } else if (nputil.gettype(res.headers[headLowered]) === 'string') {
                                    if (res.headers[headLowered].toLowerCase() !== receiveheaders[head].toLowerCase()) {
                                        jobinfo.results.success = false;
                                        jobinfo.results.message += ' HTTP header '+head+' mismatch: '+res.headers[headLowered]+'. ';
                                    }
                                } else {
                                    if (nputil.gettype(res.headers[headLowered]) === 'array' && res.headers[headLowered][0]) {
                                        if (res.headers[headLowered][0].toLowerCase() !== receiveheaders[head].toLowerCase()) {
                                            jobinfo.results.success = false;
                                            jobinfo.results.message += ' HTTP header '+head+' mismatch: '+res.headers[headLowered]+'. ';
                                        }
                                    } else {
                                        jobinfo.results.success = false;
                                        jobinfo.results.message += ' HTTP header '+head+' mismatch: '+sys.inspect(res.headers[headLowered])+'. ';
                                    }
                                }
                            }
                            if (!jobinfo.results.success) {
                                resultobj.process(jobinfo);
                                return true;
                            }
                        }
                        if(jobinfo.parameters.contentstring){
                            if (res.headers['content-encoding'] === 'gzip') {
                                body = false;
                                var buffer = Buffer.concat(chunks);
                                debugMessage('info',"check_httpadv: gzip encoding");
                                zlib.gunzip(buffer, function (gunzipError, gunzippedbody) {
                                    if (gunzipError) {
                                        debugMessage('error',"check_httpadv: gzip error: "+sys.inspect(gunzipError));
                                        jobinfo.results.success = false;
                                        jobinfo.results.message = 'Unable to gunzip reply';
                                        resultobj.process(jobinfo);
                                        return true;
                                    }
                                    lookForContent(jobinfo, gunzippedbody);
                                });
                            } else if (res.headers['content-encoding'] === 'deflate') {
                                body = false;
                                var buffer = Buffer.concat(chunks);
                                debugMessage('info',"check_httpadv: deflate encoding");
                                zlib.inflate(buffer, function (inflateError, deflatebody) {
                                    if (inflateError) {
                                        debugMessage('error',"check_httpadv: deflate error: "+sys.inspect(inflateError));
                                        jobinfo.results.success = false;
                                        jobinfo.results.message = 'Unable to deflate reply';
                                        resultobj.process(jobinfo);
                                        return true;
                                    }
                                    lookForContent(jobinfo, deflatebody);
                                });
                            } else {
                                lookForContent(jobinfo, body);
                            }
                            return true;
                        }
                        resultobj.process(jobinfo);
                        return true;
                    }
                    return true;
                });
                return true;
            });
            req.on("error", function(e){
                clearTimeout(timeoutid);
                debugMessage('info',"check_httpadv: req error called for "+jobinfo._id+': '+sys.inspect(e));
                if(!killit){
                    killit = true;
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = 'Error';
                    jobinfo.results.success = false;
                    jobinfo.results.message = e.toString();
                    if (jobinfo.results.message.indexOf('alert number 80' > 0)) {
                        // HTTPS that isn't running TLS
                        jobinfo.results.message = 'https URL that is not running SSL';
                    }
                    resultobj.process(jobinfo);
                }
                req.abort();
                return true;
            }).on("timeout", function(to){
                clearTimeout(timeoutid);
                debugMessage('info',"check_httpadv: req timeout called for "+jobinfo._id);
                if(!killit){
                    killit = true;
                    //logger.log('info',"check_httpcontent: Caught timeout");
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = 'Timeout';
                    jobinfo.results.success = false;
                    jobinfo.results.message = 'Timeout';
                    resultobj.process(jobinfo);
                }
                req.abort();
                return true;
            });
            req.on("socket", function (socket) {
                debugMessage('info',"check_httpadv: req socket called for "+jobinfo._id);
                jobinfo.results = {start:new Date().getTime()};
                socket.emit("agentRemove");
            });
            if(dataToSend != ''){
                req.write(dataToSend);
            }
            req.end();
            //debugMessage('info',"check_httpadv: req for "+jobinfo._id+': '+sys.inspect(req));
        }catch(ec){
            clearTimeout(timeoutid);
            if(!killit){
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.success = false;
                jobinfo.results.message = "Caught "+ec.toString();
                resultobj.process(jobinfo);
                killit = true;
            }
            if (req) {
                req.abort();
            }
            return true;
        }
    }
    return true;
};

exports.check = check;
