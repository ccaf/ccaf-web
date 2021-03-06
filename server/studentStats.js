exports.sessionStats = {};

exports.makeStudentStatsTracker = function(db, sessionId) {
    // Create tracker and load any existing session data
    var tracker = new StudentStatsTracker(db, sessionId);
    tracker.loadFromDB();

    // Add methods for recording drawing events
    tracker.setRecorder("addFreeDrawing", "addFreeDrawing", function(key, updateObj, timestamp) {
        // Store the number of points in the path
        var pathLength = updateObj.data.path.length;
        this.push(key, pathLength, updateObj.meta, timestamp);
    });

    // Generic recorder for point values that don't change
    var makeFixedPointsRecorder = function(points) {
        return function(key, updateObj, timestamp) {
            this.push(key, points, updateObj.meta, timestamp);
        };
    };

    tracker.setRecorder("addFBDObject", "addFreeDrawing", makeFixedPointsRecorder(20));
    tracker.setRecorder("modifyObject", "addFreeDrawing", makeFixedPointsRecorder(10));
    tracker.setRecorder("removeObject", "addFreeDrawing", makeFixedPointsRecorder(10));
    tracker.setRecorder("undoAddObject", "addFreeDrawing", makeFixedPointsRecorder(5));
    tracker.setRecorder("undoModifyObject", "addFreeDrawing", makeFixedPointsRecorder(5));
    tracker.setRecorder("undoRemoveObject", "addFreeDrawing", makeFixedPointsRecorder(5));


    tracker.setRecorder("setPage", "setPage", function(key, updateObj, timestamp) {
        this.pageNumbers = this.pageNumbers || {};
        for(var userId in updateObj.data) {
            this.pageNumbers[userId] = updateObj.data[userId];
        }
    });

    // Add methods for calculating interesting things from the raw event data
    tracker.setReporter("contributionToGroup", function(args) {
        // Get last minute of data (TODO store interval with process.env?)
        //var recentDrawing = this.getInterval("addFreeDrawing", Date.now() - 60000);
        
        // Get cumulative contributions over class
        var recentDrawing = this.getInterval("addFreeDrawing");
        
        var groupTotals = {};
        for(var i = 0, len = recentDrawing.data.length; i < len; i++) {
            var pathLength = recentDrawing.data[i],
                meta = recentDrawing.meta[i];
        
            if(!(meta.g in groupTotals)) {
                groupTotals[meta.g] = {total: 0};
            }

            groupTotals[meta.g][meta.u] = (groupTotals[meta.g][meta.u] + pathLength) || pathLength;
            groupTotals[meta.g].total += pathLength;
        }

        ////
        return groupTotals;
    });


    tracker.setReporter("groupHistory", function(args) {
        // TODO store this somewhere
        //var groupHistoryUpdateInterval = 5 * 60 * 1000;
        var groupHistoryUpdateInterval = 60 * 1000;

        this.groupHistory = this.groupHistory || [];
        this.latestHistoryUpdate = this.latestHistoryUpdate || this.sessionStartTime;
        
        var now = Date.now();
        while((now - this.latestHistoryUpdate) >= groupHistoryUpdateInterval) {
            var nextHistoryUpdate = this.latestHistoryUpdate + groupHistoryUpdateInterval;
            var drawingData = this.getInterval("addFreeDrawing", this.latestHistoryUpdate, nextHistoryUpdate);

            // Add up group totals
            var groupTotals = {};
            for(var i = 0, len = drawingData.data.length; i < len; i++) {
                var groupId = drawingData.meta[i].g,
                    pathLength = drawingData.data[i];
                groupTotals[groupId] = (groupTotals[groupId] + pathLength) || pathLength;
            }
            groupTotals.time = nextHistoryUpdate;
            this.groupHistory.push(groupTotals);

            this.latestHistoryUpdate = nextHistoryUpdate;
        }

        return this.groupHistory;
    });

    // Reporter method for users' page numbers
    tracker.setReporter("pageNumber", function(args) {
        return this.pageNumbers || {};
    });

    exports.sessionStats[sessionId] = tracker;
};

// Save a session's stats data every minute
var dbWriteInterval = 60 * 1000;

function StudentStatsTracker(db, sessionId) {
    this.db = db;
    this.sessionId = sessionId;
    
    var stmt = db.prepare("SELECT startTime FROM classroom_sessions WHERE id=:sessionId;", {
        ":sessionId": sessionId
    });
    if(!stmt.step())
        throw "Couldn't get session start time for session " + sessionId;
    else
        this.sessionStartTime = stmt.getAsObject().startTime;

    this.recorders = {};
    this.reporters = {};

    this.storeKeys = {};

    this.lastSavedIdx = {};

    this._data = {};
    this._meta = {};
    this._timestamps = {};

    // Start saving to the database (wait first)
    setTimeout((function() {
        this.interval = setInterval(this.saveToDB.bind(this), dbWriteInterval);
    }).bind(this), dbWriteInterval);
}


// Stores a callback to record a certain type of event
StudentStatsTracker.prototype.setRecorder = function(inputKey, storeKey, recorderCB) {
    this.recorders[inputKey] = recorderCB.bind(this);
    this.storeKeys[inputKey] = storeKey;
    
    // make arrays for recording update events and times
    this._data[storeKey] = [];
    this._meta[storeKey] = [];
    this._timestamps[storeKey] = [];
};


// If an update has metadata and there is a matching recorder callback, run
// the callback for the update message
StudentStatsTracker.prototype.processUpdate = function(updateObj, timestamp) {
    if(updateObj.meta) {
        // Choose the recorder callback
        var inputKey = updateObj.meta.type;
        var recorderCB = this.recorders[inputKey];
        if(recorderCB)
            recorderCB(this.storeKeys[inputKey], updateObj, timestamp);
    }
};
    

// Method for pushing a timestamped event onto the appropriate array
StudentStatsTracker.prototype.push = function(key, data, meta, timestamp) {
    if((key in this._data) && (key in this._timestamps)) {
        // Timestamp might not be defined; default is now
        if(!timestamp)
            timestamp = Date.now();

        this._timestamps[key].push(timestamp);
        this._meta[key].push(meta);
        this._data[key].push(data);
    }
};


// Get all events from the channel given by "key" on the interval [startTime, endTime).
StudentStatsTracker.prototype.getInterval = function(key, startTime, endTime) {
    if((typeof startTime) == "undefined") {
        return {
            data: this._data[key],
            meta: this._meta[key],
            timestamps: this._timestamps[key]
        };
    } else if((typeof endTime) == "undefined") {
        endTime = null;
    }

    // Seek back through timestamps to find end points
    var timestamps = this._timestamps[key],
        data = this._data[key],
        meta = this._meta[key];
    var startIdx = timestamps.length,
        endIdx = timestamps.length;
    for(var i = timestamps.length - 1; i > -1; i--) {
        if(timestamps[i] < startTime) {
            break;
        } else {
            startIdx = i;
        }

        if(endTime) {
            if(timestamps[i] < endTime) {
                endTime = null;
            } else {
                endIdx = i;
            }
        }
    }
    
    return {
        data: data.slice(startIdx, endIdx),
        meta: meta.slice(startIdx, endIdx),
        timestamps: timestamps.slice(startIdx, endIdx)
    };
}


// Add a method for reporting things about already recorded data
StudentStatsTracker.prototype.setReporter = function(reporterKey, reporterCB) {
    this.reporters[reporterKey] = reporterCB.bind(this);
};


// Run a reporter method
StudentStatsTracker.prototype.report = function(reporterKey, args) {
    if(reporterKey in this.reporters) {
        return this.reporters[reporterKey](args);
    } else {
        console.log('No reporter method "' + reporterKey + '" found');
    }
};


StudentStatsTracker.prototype.reportAll = function(args) {
    var results = {};
    for(var reporterKey in this.reporters) {
        results[reporterKey] = this.reporters[reporterKey](args);
    }
    return results;
};


// Save all data to the database
StudentStatsTracker.prototype.saveToDB = function() {
    this.db.run("PRAGMA foreign_keys = on;");
    
    for(var recorderKey in this.recorders) {
        var storeKey = this.storeKeys[recorderKey];
        var startIdx = this.lastSavedIdx[storeKey];

        // Write all new events to the database
        var timestamps = this._timestamps[storeKey],
            data = this._data[storeKey],
            meta = this._meta[storeKey];
        var endIdx = data.length;
        for(var i = startIdx; i < endIdx; i++) {
            this.db.run("INSERT INTO stats_events VALUES (:type, :timestamp, :data, :meta, :session);", {
                ":type": storeKey,
                ":timestamp": timestamps[i],
                ":data": JSON.stringify(data[i]),
                ":meta": JSON.stringify(meta[i]),
                ":session": this.sessionId
            });
        }

        // Keep track of which event we wrote last
        this.lastSavedIdx[storeKey] = endIdx;
    }
};


// Load events from the database
StudentStatsTracker.prototype.loadFromDB = function() {
    // Discard any existing data
    this._data = {};
    this._meta = {};
    this._timestamps = {};
    
    // Fetch from database by type
    var stmt = this.db.prepare("SELECT * FROM stats_events WHERE sessionId=:session "
        + "ORDER BY timestamp;", {
        ":session": this.sessionId
    });

    while(stmt.step()) {
        var ev = stmt.get();
        var storeKey = ev[0];
        if(!(storeKey in this._data)) {
            this._timestamps[storeKey] = [];
            this._data[storeKey] = [];
            this._meta[storeKey] = [];
        }

        // TODO run recorders??

        this._timestamps[storeKey].push(ev[1]);
        this._data[storeKey].push(JSON.parse(ev[2]));
        this._meta[storeKey].push(JSON.parse(ev[3]));
    }


    // Keep track of what's already in the database
    for(var storeKey in this._timestamps) {
        this.lastSavedIdx[storeKey] = this._timestamps[storeKey].length - 1;
    }
};


// Save to the database and cancel future saving.
StudentStatsTracker.prototype.quit = function() {
    this.saveToDB();
    if(this.interval)
        clearInterval(this.interval);
};


