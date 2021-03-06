define(["exports", "pdfjs-dist/build/pdf.combined", "mithril", "jquery", "bootstrap", "models", "css", "uuidv1", "userColors", "./mechanicsObjects.js"], function(exports, pdfjs, m, $, bootstrap, models, css, uuidv1, userColors, mechanicsObjects) {
    
    // Disable two-or-more finger touches to prevent pinch zooming
    document.addEventListener('touchstart', function(e){
        if( e.touches.length > 1) {   
            e.preventDefault();
        }
    }, {passive: false});

  var PDFJS = pdfjs.PDFJS;
  var Activity = models.Activity,
      ActivityPage = models.ActivityPage,
      ClassroomSession = models.ClassroomSession,
      Group = models.Group,
      User = models.User;
  var getUserColor = userColors.getColor;
  var array;
 
  // Flag to show ControlledLine and ControlledCurve in the mechanics objects menu
    var showVMLines = false,
        logAcceleration = false;

    // Virtual pixel dimensions of PDF pages
    var virtualPageWidth = 1500,
        virtualPageHeight = virtualPageWidth * 11.0 / 8.5;

    // Limits on object scaling
    var minScale = 0.25,
        maxScale = 3.0;
    var minScaleX = minScale,
        minScaleY = minScale,
        maxScaleX = maxScale,
        maxScaleY = maxScale;

   var toolNames = [
       'pen',
       'highlighter',
       'eraser',
       'finger',
       'shapes'
   ];

   var penColors = [
       '#000000', // black
       '#ff0000', // red
       '#00ff00', // green
       '#0000ff', // blue
       '#ffff00', // yellow
       '#ff00ff', // purple
       '#00ffff' // teal
   ];

   var realViewHeight = 1;

   var errmsg = null, errobj = null;
   var errorPrompt = function(msg, obj) {
        errmsg = msg;
        errobj = obj;
        m.redraw(true);
   };
                
   var makeRGBA = function(hexstring, alpha) {
        var hexR = hexstring.slice(1,3),
            hexG = hexstring.slice(3,5),
            hexB = hexstring.slice(5,7);
        return 'rgba(' + parseInt(hexR, 16) + ', '
                + parseInt(hexG, 16) + ', '
                + parseInt(hexB, 16) + ', '
                + alpha + ')';
   };

  exports.load = function(connection, el, params) {
    array = connection.array;
    exports.logOnly = connection.logOnly.bind(connection);
    connection.errorCallback = errorPrompt;
    css.load("/apps/whiteboard/styles.css");
    var appReturn = {};
    
    // If we load the app in observer mode, wrap all components in an invisible
    // div to catch events
    var ctrl;
    var mainArgs = {
          pdf: params.pdf,
          user: params.user.id,
          session: params.session.id,
          observerMode: params.observerMode,
          connection: connection,
            group: params.group,
            groupTitle: params.groupObject.title,
            appReturn: appReturn,
            exitCallback: params.exitCallback
        };

      // Check if the session is playing back
      if(connection.store && connection.store.playback) {
        params.observerMode = connection.store.playback[0];
      }

    if(params.observerMode) {
      ctrl = m.mount(el, m.component(ObserverWrapper, mainArgs));
    } else {
      ctrl = m.mount(el, m.component(Main, mainArgs));
    }


    ///////////////
    // TODO remove this
    connection.addObserver(function(store) {
      if (store.scrollPositions) {
        ctrl.scrollPositions = store.scrollPositions || {};
      }

      //ctrl.remotePages(store.pages || {});
      requestAnimationFrame(m.redraw);
    });
    ///////////////

    window.addEventListener("resize", m.redraw.bind(null, true));
    window.addEventListener("resize", function(e) {
        realViewHeight = document.body.clientHeight;
    });

    document.addEventListener("visibilityChange", function() {
        var data = {};
        data[params.user.id] = document.visibilityState;
        connection.logOnly("appVisible", data);
    });

    // Return a callback to save screenshots for students
    return appReturn;
  };

  // TODO remove??
  function dist(x1, y1, x2, y2) {
    var d = Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
    return d;
  }

  var ObserverWrapper = {
      // ObserverWrapper: should cover all of the app except for page change and
      // playback controls
    controller: function(args) {
        var ctrl = {
            resetting: false           
        };

        args.connection.transaction([["playback"]], function(isPlayback) {
            isPlayback[0] = true;
        });

        return ctrl;
    },
    view: function(ctrl, args) {
        return m("#observerWrapper", {
                config: function(el, isInit) {
                    if(isInit)
                        return;
                    
                    // Capture all events
                    el.addEventListener('mousedown', function(e) {
                        //console.log('captured mousedown event');
                        e.stopPropagation();
                    }, true);
                },
 
            },
            ctrl.resetting ? null : m.component(Main, args),
            m.component(PlaybackControls, args)
        );
    }
  };


    var PlaybackControls = {
        controller: function(args) {
            var ctrl;
            ctrl = {
                lastMode: "pause",
                draggingSeek: false,
                seekBarPosition: 0,
                secondUpdateInterval: null,
                playbackTime: 0,
                duration: 0,
                mouseOver: false,
               
                seek: function(time) {
                    // Ask the server to seek to the given time relative to the
                    // beginning of the session
                    args.connection.transaction([['playback']], function(playback) {
                        playback.mode = "seek";
                        playback.time = time;
                        ctrl.playbackTime = time;
                    });

                    // TODO add one-time observers to handle page change etc.
                },
                seekFromBar: function(e, el) {
                    var seekPercent = 100 * e.offsetX / el.clientWidth;
                    ctrl.seek(ctrl.getSeekTime(seekPercent));
                    ctrl.draggingSeek = false;
                    //console.log(e);
                },
                getSeekPercent: function() { 
                    if(ctrl.duration) {
                        return 100 * ctrl.playbackTime / ctrl.duration;
                    } else {
                        return 0;
                    }
                },
                getSeekTime: function(percent) {
                    return (percent / 100) * ctrl.duration;
                },
                getTimeString: function() {
                    var formatTime = function(date) {
                        var hours = date.getUTCHours(),
                            minutes = date.getMinutes(),
                            seconds = date.getSeconds();
                        return ("" + hours + ":" + (minutes >= 10 ? "" : "0")
                            + minutes + ":" + (seconds >= 10 ? "" : "0") + seconds);
                    };

                    var t = new Date(ctrl.playbackTime),
                        d = new Date(ctrl.duration);
                    return formatTime(t) + " / " + formatTime(d);
                },
                togglePlayPause: function() {
                    args.connection.transaction([['playback']], function(playback) {
                        if(playback.mode == "pause") {
                            playback.mode = "play";
                        } else if(playback.mode == "play") {
                            playback.mode = "pause";
                        } else {
                            playback.mode = "play";
                        }
                    });
                },
                becomeUser: function(user) {
                    // console.log("switched user: " + user.email);
                    args.user = user.id;
                    m.redraw();
                }
            };
            
            // Watch for user list
            var userUpdate;
            userUpdate = function(store) {
                // Get group members
                ctrl.users = [];
                if(args.connection.store.users) {
                    if(Object.keys(args.connection.store.users).length != ctrl.users.length) {
                        for(var userId in args.connection.store.users) {
                            ctrl.users.push(args.connection.store.users[userId]);
                        }
                    }
                }
                args.connection.removeObserver(userUpdate);
            };
            args.connection.addObserver(userUpdate);
            
            ctrl.seek(0);

            // Set up listener for play/pause/seek events
            args.connection.addObserver(function(store, isReset) {
                if(store.playback) {
                    ctrl.duration = store.playback.duration;
                    ctrl.playbackTime = store.playback.time;
                    //console.log(ctrl.playbackTime, ctrl.duration);
                    if(store.playback.mode == "play" && ctrl.lastMode != "play") {
                        // start updating the time
                        ctrl.secondUpdateInterval = setInterval(function() {
                            ctrl.playbackTime += 1000;
                            if(!ctrl.draggingSeek) {
                                ctrl.seekBarPosition = ctrl.getSeekPercent();
                            }

                            // check for end of playback
                            if(ctrl.playbackTime >= ctrl.duration) {
                                // console.log("reached end of playback");
                                ctrl.togglePlayPause();
                                return;
                            }
                            m.redraw(true);
                        }, 1000);
                        
                        ctrl.lastMode = "play";
                    } else if(store.playback.mode != "play" && ctrl.lastMode == "play") {
                        
                        if(ctrl.secondUpdateInterval)
                            clearInterval(ctrl.secondUpdateInterval);

                        ctrl.lastMode = store.playback.mode;
                    }
                }
            });


            return ctrl;
        },
        view: function(ctrl, args) {

            return m("div",
                m("div#playback-controls", {
                    onmouseenter: function(e) {
                        ctrl.mouseOver = true;
                        e.target.style.opacity = 1.0;
                    },
                    onmouseleave: function(e) {
                        ctrl.mouseOver = false;
                        e.target.style.opacity = 0.7;
                    }
                },
                    m("button.btn.btn-primary", {
                        onclick: ctrl.togglePlayPause,
                    }, m(".playback-button-text", {
                        style: "text-align: center"
                    },
                        (ctrl.lastMode == "play" ? m.trust("&#9612;&#9612;") : m.trust("&#x25b6;")))),
                    m("#playbackTime", ctrl.getTimeString()),
                    ctrl.mouseOver ? ctrl.users.map(user => m("a.playback-name", {onclick: ctrl.becomeUser.bind(null, user)}, user.name)) : ""
                ),
                m("svg#playbackSeekBar", {
                    onmousedown: function(e) {
                        // Get seek position
                        ctrl.draggingSeek = true;
                        ctrl.seekBarPosition = 100 * (e.offsetX / e.target.clientWidth);
                    },
                    onmousemove: function(e) {
                        if(ctrl.draggingSeek)
                            ctrl.seekBarPosition = 100 * (e.offsetX / e.target.clientWidth);
                    },
                    onmouseup: function(e) {
                        if(e.target.clientWidth) {
                            ctrl.seekFromBar(e, e.target);
                        }
                    },

                    width: '100%',
                    height: '1em'
                }, 
                    m("rect#playbackElapsed", {
                        width: '' + ctrl.getSeekPercent() + '%',
                        height: '100%',
                        color: 'blue',
                        onmouseup: function(e) {
                            ctrl.seekFromBar(e, e.target.parentElement);
                        }
                    })
                )
            );

        }
    };

  var Main = {
    controller: function(args) {
      var ctrl = {
        userColor: function(userId) {
            return ctrl.userColors()[userId] || '#888888';
        },
        allowUndo: m.prop({}),
        lastToModify: {},
        numPages: m.prop([]),
        scrollPositions: {},
        scroll: m.prop("open"),
        scrollDragging: m.prop(false),

        title: m.prop(args.groupTitle),

        // stores index of current document for each user
        pageNumbers: m.prop({}),

        connection: args.connection,
        addObserver: args.connection.addObserver.bind(args.connection),

        tool: m.prop(0),
        penColorIdx: m.prop(0),
        fireScrollEvent: true,
        curId: {},
        user: args.user,
        session: args.session,
        activity: m.prop(null),
        docs: m.prop({}),
        firstLoad: true,
        user: args.user,
        myColor: function() {
            return ctrl.userColor(args.user);
        },
        lastDrawn: m.prop({}),

        groupUsers: [],        
        userList: m.prop([]),
        updateQueue: [],

        nextObjectUpdateIdx: 0,
        pageCount: m.prop(0),

        // TODO check this properly
        offline: m.prop(false),

        me: m.prop(null),

        //for individually display student's work
        sel_user: -1,
        exitCallback: function(appCallback) {
            if(ctrl.snapshotInterval) {
                clearInterval(ctrl.snapshotInterval);
            }

            // If we're a student, save pages before quitting, otherwise just quit
            var myType = ctrl.me().type;
            if((myType == 2) || (myType == 'student') || (myType == 'Student'))
                ctrl.saveSnapshots(args.exitCallback.bind(null, appCallback));
            else
                args.exitCallback(appCallback);
        },

        // make a canvas ID string from document and page numbers
        getCanvasId: function(docIdx, pageNum) {
            return "drawSurface-" + docIdx + "-" + pageNum;
        },

        // parse document and page numbers from a canvas ID string
        parseCanvasId: function(canvasId) {
            var rest = canvasId.slice("drawSurface-".length);
            var hyphenIdx = rest.indexOf('-');
            return {
                doc: rest.slice(0, hyphenIdx),
                page: rest.slice(hyphenIdx + 1)
            };
        },

        saveCanvases: function(docId) {
            var docs = ctrl.docs();
            var canvases = docs[docId].canvas;
            for(var pn in canvases) {
                var contents = docs[docId].canvasContents[pn] = [];
                canvases[pn].forEachObject(function(obj) {
                    if(!obj.excludeFromExport) {
                        var frozen = obj.toObject(["name", "uuid", 'left', 'top', 'x1', 'y1', 'x2', 'y2']);
                        if(obj.group) {
                            frozen.left += obj.group.left + (obj.group.width / 2);
                            frozen.top += obj.group.top + (obj.group.height / 2);
                        }
                        contents.push(frozen);
                    }
                });
            }
            ctrl.docs(docs);
        },

        flushUpdateQueue: function(pageNum, canvNum) {    
            var canvases = ctrl.docs()[pageNum].canvas,
                queue = ctrl.updateQueue;

            
            //console.log(canvases);
            for(var i = 0; i < queue.length; i++) {
                var update = queue[i];
                if(update) {
                    // If the update belongs on the current document, apply
                    // and delete the entry in the queue
                    if(update.meta.doc == pageNum) {
                        if(((typeof canvNum) == "undefined") || (update.meta.page == canvNum)) {
                            //console.log(update.meta.page);
                            ctrl.applyUpdate(update.data, canvases[update.meta.page]);
                            delete queue[i];
                            i--;
                        }
                    }
                }
            }
        },

        // for recording which document each user is looking at
        setPage: function(pageNum) {
            //ctrl.flushUpdateQueue(pageNum);
            
            // console.log('Set page number: ' + pageNum);

            // Notify group
            args.connection.transaction([["setPage"]], function(userCurrentPages) {
                userCurrentPages.data = userCurrentPages.data || "{}";
                var pageNumData = JSON.parse(userCurrentPages.data);
                pageNumData[args.user] = pageNum;
                userCurrentPages.data = JSON.stringify(pageNumData);
                userCurrentPages.meta = ctrl.makeTransactionMetadata("setPage");
            });
        },

        setScroll: function(pos) {
          //var scrollPositions = ctrl.scrollPositions();
          args.connection.transaction([["scrollPositions", args.user, ctrl.pageNumbers()[args.user]]], function(userScrollPositions) {
            userScrollPositions.pos = pos;

            // Report the part of the page the user can actually see
            /**/
            var docHeight = ctrl.docs()[ctrl.pageNumbers()[args.user]].totalRealHeight,
                innerRange = docHeight - realViewHeight;
            userScrollPositions.viewTop = pos * innerRange / docHeight;
            userScrollPositions.viewBottom = (realViewHeight + (pos * innerRange)) / docHeight;
            /**/

            // dumb
            if(!ctrl.scrollPositions) {
                ctrl.scrollPositions = {};
            }
            if(!ctrl.scrollPositions[args.user]) {
                ctrl.scrollPositions[args.user] = {};
            }
            ctrl.scrollPositions[args.user][ctrl.pageNumbers()[args.user]] = userScrollPositions;
          });
        },

        setTool: function(toolId) {
            args.connection.transaction([["tool", args.user]], function(tool) {
                tool.tool = ctrl.tool(toolId);
            });
        },

        setPenColor: function(penColorIdx) {
            args.connection.transaction([["penColor", args.user]], function(color) {
                color.color = penColors[ctrl.penColorIdx(penColorIdx)];
            });
        },

        getScroll: function(userId, pageNumber) {
           return (ctrl.scrollPositions[userId]) 
            ? ((ctrl.scrollPositions[userId][pageNumber]) 
                ? ctrl.scrollPositions[userId][pageNumber].pos
                : 0)
            : 0;
        },

        undo: function() {
            // Get the undo stack
            var tabProps = ctrl.docs()[ctrl.pageNumbers()[args.user]];
            if(!tabProps)
                  return;
 
            var undoEvent, nextUndoEvent;
            do {
                undoEvent = tabProps.undoStack.pop();
                if(undoEvent) {
                    //console.log(undoEvent);
                    var canvas = tabProps.canvas[undoEvent.page];
                    
                    // Clear the selection
                    canvas.deactivateAll();
                    
                    if(ctrl.lastToModify[undoEvent.uuid] != args.user) {
                        tabProps.undoStack = [];
                        break;
                    }

                    // Does the object exist on the canvas?
                    if(undoEvent.uuid in canvas.objsByUUID) {
                        if(undoEvent.name == 'remove') {
                            ctrl.removeObject(canvas.objsByUUID[undoEvent.uuid], canvas, true, true, "undoAddObject", true);
                        } else {
                            // Modify object
                            ctrl.modifyObject(undoEvent, canvas, true, true, "undoModifyObject", true);
                        }
                    } else {
                        if(undoEvent.name != 'remove')
                            ctrl.addObject(undoEvent, canvas, true, true, "undoRemoveObject", true);
                    }

                    canvas.renderAll();
                } else {
                    break;
                }
                nextUndoEvent = tabProps.undoStack[tabProps.undoStack.length - 1];
            } while(undoEvent && undoEvent.groupID && nextUndoEvent && (undoEvent.groupID == nextUndoEvent.groupID));

            if(tabProps.undoStack.length == 0)
                ctrl.allowUndo()[ctrl.pageNumbers()[args.user]] = false;
        },

          // Make a JSON string with default metadata and any additional properties to include
          makeTransactionMetadata: function(transactionType, optExtra) {
            optExtra = optExtra || {};
            return JSON.stringify(Object.assign({
                type: transactionType,
                u: args.user,
                g: args.group,
                s: args.session
            }, optExtra));
          },


          setSelectionBox: function(groupObj, doc, page) {
              // Send an update about the area we're selecting
              args.connection.transaction([["selectionBox", args.user]], function(selectionBox) {
                  if(groupObj) {
//                      if (!(e.target.uuid in ctrl.canvas.objsByUUID) && e.target.type != "group") {
//                                return;
//                            }
                      selectionBox.visible = true;

                      // the box
                      selectionBox.left = groupObj.left;
                      selectionBox.top = groupObj.top;
                      selectionBox.width = groupObj.width;
                      selectionBox.height = groupObj.height;

                      // the contents
                      selectionBox.contents = [];
                      if(groupObj.objects) {
                          for(var i = 0, len = groupObj.objects.length; i < len; i++) {
                            selectionBox.contents.push(groupObj.objects[i].uuid);
                          }
                      } else {
                          selectionBox.contents.push(groupObj.uuid);
                      }

                      // the page
                      selectionBox.doc = doc;
                      selectionBox.page = page;
                  } else {
                      selectionBox.visible = false;
                      
                  }
              });
          },

          serializeObject: function(obj) {
              if(!obj.toObject)
                  return obj;

              var frozen = obj.toObject(['uuid']);
              
              // If the object is in a group, save correct scaling and rotation
              if(obj.group) {
                  // Taken from Group:_setObjectPosition
                  var group = obj.group;
                  var center = group.getCenterPoint(),
                      rotated = group._getRotatedLeftTop(obj);

                  Object.assign(frozen, {
                      angle: obj.getAngle() + group.getAngle(),
                      left: center.x + rotated.left,
                      top: center.y + rotated.top,
                      scaleX: obj.get('scaleX') * group.get('scaleX'),
                      scaleY: obj.get('scaleY') * group.get('scaleY')
                  });
              }

              if(!frozen.uuid)
                  frozen.uuid = obj.uuid;

              return frozen;
          },

          doObjectTransaction: function(obj, canvas, transactionType) {
              if(!obj.uuid) {
                  console.warn("Missing uuid for transaction");
                //   console.log(obj);
                  return;
              };

            args.connection.transaction([["objects", obj.uuid], ["latestObjects", "+"]], function(objects, latestObjects) {
                ctrl.curId[obj.uuid] = objects._id || 0;
                
                latestObjects[0] = obj.uuid;

                obj = ctrl.serializeObject(obj);

                // Damn son that was easy!
                objects.data = JSON.stringify(obj);
                objects.meta = ctrl.makeTransactionMetadata(transactionType, {
                    page: canvas.page,
                    doc: canvas.doc,
                    uuid: obj.uuid,
                    _id: ctrl.curId[obj.uuid]
                });

                ctrl.lastToModify[obj.uuid] = args.user;
            });

            m.redraw();
          },

        addObject: function(obj, canvas, doAdd, doTransaction, transactionType, skipUndo) {
            if(doAdd) {

                
                // Make
                if(obj.name == "controlCurvedLine") {
                    obj = mechanicsObjects.addControlledCurvedLine(null, obj);
                } else if(obj.type == "path") {
                    obj = new fabric.Path(obj.path, obj);
                } else if(obj.type == "line" || obj.type == "ControlledLine") {
                    obj = mechanicsObjects.addControlledLine(null, obj);
                } else if(obj.type && obj.type != 'circle') {
                    //console.log(obj.type);
                    obj = new mechanicsObjects[obj.type](obj);       
                } else {
                    // Do nothing if obj.type isn't defined
                    return;
                }
                
                //use the following code to work on displaying certain student's writing. 
                //Make drawings from non-selected users invisible.
                if (ctrl.me().type != 2 && ctrl.sel_user != -1){
                    if (ctrl.lastToModify[obj.uuid] != ctrl.sel_user){
                        obj.visible = false;;
                    }
                    else {
                        obj.visible = true;
                    }
                }
                else {
                    obj.visible = true;
                }

                // Add
                if(obj instanceof Array) {
                    canvas.add.apply(canvas, obj);
                //} else if((obj.type == "ControlledLine") || (obj.type == "ControlledCurve")) {
                    //canvas.add.apply(canvas, obj.objects);
                } else {
                    canvas.add(obj);
                }

            }
 
            // If there are control handles, they have been added to the canvas and can be ignored now.
            if(obj instanceof Array) {
                obj = obj[0];
            }

            // Generate UUID if none present for object
            if(!obj.uuid) {
                obj.uuid = uuidv1();
            }
             
            // Store object with canvas by uuid
            canvas.objsByUUID[obj.uuid] = obj;
            
            canvas.prevObjectState[obj.uuid] = Object.assign(obj.toObject(['uuid']), {uuid: obj.uuid});

            if(!skipUndo) {
                canvas.pushUndo({
                    name: "remove",
                    uuid: obj.uuid,
                });
                ctrl.allowUndo()[ctrl.pageNumbers()[args.user]] = true;
            }

            // Send the object
            if(doTransaction)
                ctrl.doObjectTransaction(obj, canvas, transactionType);
        },

        modifyObject: function(obj, canvas, doModify, doTransaction, transactionType, skipUndo) {
            if(doModify) {
                var canvasObj = canvas.objsByUUID[obj.uuid];
                                                                    // need to rebuild if it's a curve
                if((obj.type == "path" || obj.type == "Arrow") && obj.name != "controlCurvedLine") {
                    // object exists so modify it
                    canvasObj.set(obj);
                    canvasObj.setCoords();
                } else {
                    // Some MechanicsObjects don't behave well when modified so for now we will
                    // tear down and remake the object
                    ctrl.removeObject(canvasObj, canvas, true, false, "modifyRemove", true);
                    ctrl.addObject(obj, canvas, true, false, "modifyAdd", true);
                }

                canvas.renderAll();
            }
                    
            if(!skipUndo) {
                // Add previous state of object to the undo stack
                var prevObjectState = canvas.prevObjectState[obj.uuid] || {name: "remove", uuid: obj.uuid};
                if(obj.groupID) {
                    prevObjectState.groupID = obj.groupID;
                    //delete obj.groupID;
                }
                canvas.pushUndo(prevObjectState);
                ctrl.allowUndo()[ctrl.pageNumbers()[args.user]] = true;
                //ctrl.allowUndo(true);
            }

            m.redraw();
              
            if(obj.toObject) {
                canvas.prevObjectState[obj.uuid] = ctrl.serializeObject(obj);
            } else {
                canvas.prevObjectState[obj.uuid] = obj;
            }

            if(doTransaction)
                ctrl.doObjectTransaction(obj, canvas, transactionType);
        },

        removeObject: function(obj, canvas, doRemove, doTransaction, transactionType, skipUndo) {
            if(obj.excludeFromExport && obj.target)
                obj = obj.target;

            if(doRemove) {
                if(obj.target)
                    removeObject(obj.target, canvas, doRemove, doTransaction, transactionType, skipUndo);

                canvas.remove(obj);
            }

            if(obj.uuid in canvas.objsByUUID)
                delete canvas.objsByUUID[obj.uuid];

            // Push onto undo stack
            if(!skipUndo) {
                if(obj.toObject)
                    obj = obj.toObject(['uuid', 'groupID']);
                canvas.pushUndo(obj);
                //ctrl.allowUndo(true);
                ctrl.allowUndo()[ctrl.pageNumbers()[args.user]] = true;
            }

            if(doTransaction)
                ctrl.doObjectTransaction({uuid: obj.uuid, name: "remove"}, canvas, transactionType);
        },
 
          applyUpdate: function(updateObj, canvas) {
              if(updateObj.uuid in canvas.objsByUUID) {
                  var canvasObj = canvas.objsByUUID[updateObj.uuid];
                  
                  if(updateObj.name == "remove") {
                      // Remove object
                      ctrl.removeObject(canvasObj, canvas, true, false);
                  } else {
                      // TODO make a helper (or just call modifyObject?)
                      if((updateObj.type == "path" || updateObj.type == "Arrow") && updateObj.name != "controlCurvedLine") {
                          // object exists so modify it
                          canvasObj.set(updateObj);
                          canvasObj.setCoords();
                      } else {
                          // Some MechanicsObjects don't behave well when modified so for now we will
                          // tear down and remake the object
                          ctrl.removeObject(canvasObj, canvas, true, false);
                          ctrl.addObject(updateObj, canvas, true, false);
                      }
                  }
                  canvas.renderAll();
              } else {
                  // object does not exist so create (no transaction)
                  ctrl.addObject(updateObj, canvas, true, false);
              }
          },

          userColors: m.prop({}),
          setStoreCallbacks: []
      };

        ctrl.addSetStoreCallback = function(callback) {
            ctrl.setStoreCallbacks.push(callback);
        };

        ctrl.removeSetStoreCallback = function(callback) {
            for(var i = 0; i < ctrl.setStoreCallbacks.length; i++) {
                if(ctrl.setStoreCallbacks[i] == callback) {
                    delete ctrl.setStoreCallbacks[i];
                    break;
                }
            }
        };

        // Playback set-store observer
        args.connection.addObserver(function(store, isReset) {
            // If we've recieved a set-store, remove all objects and add back
            if(isReset) {
                // clear canvas cache contents
                var docs = ctrl.docs();
                for(var docIdx in docs) {
                    docs[docIdx].canvasContents = {};
                    var numPages = ctrl.numPages()[docIdx];
                    for(var pageIdx = 0; pageIdx < numPages; pageIdx++) {
                        docs[docIdx].canvasContents[pageIdx] = [];
                    }
                }

                // set up page contents
                for(var uuid in store.objects) {
                    var update = store.objects[uuid],
                        obj = JSON.parse(update.data),
                        meta = JSON.parse(update.meta);
                    obj.uuid = uuid;
                    
                    // put object in canvas cache
                    docs[meta.doc].canvasContents[meta.page].push(obj);
                    // console.log(docs[meta.doc].canvasContents[meta.page]);

                    // set curId so we don't reject subsequent updates after rewind
                    ctrl.curId[uuid] = meta._id - 1;
                }

                // console.log(docs);

                // Run callbacks
                ctrl.setStoreCallbacks.forEach(function(callback) {
                    callback();
                });
            }
        });

      // Make our exit callback visible to whatever loaded the whiteboard app so
      // that it can be made to quit from the outside
      exports.exitCallback = ctrl.exitCallback;

      var updateColors = function() {
          var userGroup = Object.assign(new Group(), {id: args.group, title: "", classroom: -1});
          userGroup.users().then(function(userGroupList) {
              ctrl.userColors({});
              for(var i = 0, len = userGroupList.length; i < len; i++) {
                  ctrl.userColors()[userGroupList[i].id] = userColors.userColors[i];
              }
              //console.log(ctrl.userColors());
          });
      };
      updateColors();

      var userListChangeHandler = function(users) {
          ctrl.userList(users);

          // The user list has changed -- update page numbers, scroll positions, and colors.
          var oldPageNumbers = ctrl.pageNumbers(),
              oldScrollPositions = ctrl.scrollPositions;
          ctrl.pageNumbers({});
          ctrl.scrollPositions = {};
          ctrl.userList().map(function(user) {
              ctrl.pageNumbers()[user.id] = oldPageNumbers[user.id] || 0;
              ctrl.scrollPositions[user.id] = oldScrollPositions[user.id] || {};
          });

          updateColors();
          m.redraw(true);
      };

      if(args.observerMode) {
          // if playback, watch "membershipChange" events and simulate userList changes
          args.connection.addObserver(function(store) {
              if(store.membershipChange) {
                  if(store.membershipChange.action.includes("load")) {
                      // add a member
                      if(ctrl.userList().filter(user => store.membershipChange.id == user.id).length == 0) {
                          ctrl.userList().push(store.membershipChange);
                      }
                  } else {
                      // remove a member
                      if(ctrl.userList().filter(user => store.membershipChange.id == user.id).length > 0) {
                          var idx = 0;
                          for(; idx < ctrl.userList().length; idx++) {
                              if(ctrl.userList()[idx].id == store.membershipChange.id)
                                  break;
                          }
                          delete ctrl.userList()[idx];
                      }
                  }

                  // 
                  userListChangeHandler(ctrl.userList());
              }
          });
        
          // Watch page and scroll position
          args.connection.addObserver(function(store, isReset) {
              var currentPage = ctrl.pageNumbers()[args.user] || 0;
              var newPage = currentPage;
              if(store.setPage && store.setPage.data) {
                  var pages = JSON.parse(store.setPage.data);
                  if(("" + args.user) in pages) {
                      newPage = pages[args.user];
                  }
              }
              if(isReset) {
                  if(store._pages && store._pages[args.user])
                      newPage = store._pages[args.user];
                  else
                      newPage = 0;
              }

              if((newPage != currentPage) && ctrl.changePage) {
                  ctrl.changePage(currentPage, newPage);
              }

              // Set own scroll position
              var scrollPosition = store.scrollPositions ?
                  store.scrollPositions[args.user] ? 
                      store.scrollPositions[args.user][newPage] ?
                          store.scrollPositions[args.user][newPage].pos
                    : 0
                : 0
              : 0;
              if(ctrl.setMainScroll)
                  ctrl.setMainScroll(scrollPosition);

              Object.assign(ctrl.scrollPositions, store.scrollPositions);
          });
          
          // Set up user list
          var getPlaybackUsers;
          getPlaybackUsers = function(store) {
              var users = [];
              if(args.connection.store.users) {
                  for(var userId in args.connection.store.users) {
                      users.push(args.connection.store.users[userId]);
                  }
              }
              ctrl.userList(users);
              args.connection.removeObserver(getPlaybackUsers);
          };
          args.connection.addObserver(getPlaybackUsers);

      } else {
          args.connection.userList.addObserver(userListChangeHandler);
      }

        
      // Watch for selection changes
      args.connection.addObserver(function(store) {
        if(store.selectionBox) {
            var selectionBox = store.selectionBox;
            for(var userId in selectionBox) {
                var box = selectionBox[userId];
                if(ctrl.pageNumbers()[args.user] == box.doc && ctrl.docs()[box.doc]) {
                    var canvas = ctrl.docs()[box.doc].canvas[box.page];
                    if(canvas && canvas.setSelectionBox)
                        canvas.setSelectionBox(userId, box);
                }
            }
        }
      });

      // Set page number
      args.connection.addObserver(function(store) {
        if(store.setPage && store.setPage.data) {
            Object.assign(ctrl.pageNumbers(), JSON.parse(store.setPage.data));
        }
      });

      // Set selection box
        // TODO
      /*
      args.connection.addObserver(function(store) {
        for(var userId in store.selectionBox) {
            var box = store.selectionBox[userId];
            var currentDoc = ctrl.pageNumbers()[args.user];
            console.log(box);
            if(('doc' in box) && box.doc == currentDoc) {
                ctrl.drawSelectionBox(box, args.user, ctrl.docs()[currentDoc].canvas[box.page]);
            }
        }
      });
      */

    // Handle object updates
    ctrl.objectObserver = function(store) {
        //console.log(store);

        if(!store.latestObjects)
            return;

        var newLength = Object.keys(store.latestObjects).length;
        for(var i = ctrl.nextObjectUpdateIdx; i < newLength; i++) {
            var uuid = store.latestObjects[i][0];
            if(!uuid)
                continue;


        //for(var uuid in store.objects /*objmap*/) {
            var update = store.objects[uuid]; /*objmap[uuid];*/
            var updateObj = JSON.parse(update.data),
                updateMeta = JSON.parse(update.meta);
            if(updateMeta.uuid)
                updateObj.uuid = updateMeta.uuid;
            
            ctrl.lastToModify[uuid] = updateMeta.u;
            
            if(!(uuid in ctrl.curId)) {
                ctrl.curId[uuid] = updateMeta._id - 1;
            }

            if(updateMeta._id > ctrl.curId[uuid]) {
                ctrl.curId[uuid] = updateMeta._id;

                var canvas = ctrl.docs()[updateMeta.doc] ? ctrl.docs()[updateMeta.doc].canvas[updateMeta.page] : null;
                if(canvas && (updateMeta.doc == ctrl.pageNumbers()[args.user])) {
                    ctrl.applyUpdate(updateObj, canvas);
                } else {
                    // console.log("queued update");
                    ctrl.updateQueue.push({data: updateObj, meta: updateMeta});
                }
            }
        }

        ctrl.nextObjectUpdateIdx = newLength;

        if(ctrl.firstLoad) {
            ctrl.firstLoad = false;
        }
    };

    args.connection.addObserver(ctrl.objectObserver);

    // Get dimensions for rendering PDF. We don't re-render the PDF when the size 
    // changes since it's expensive.
    //
    // TODO remove?
    var pdfWidth = document.body.clientWidth,
        pdfHeight = pdfWidth * 11.0 / 8.5;

      // Load all pdfs right away
      ClassroomSession.get(args.session).then(function(session) {
          // Retrieve activity info for the session
          Activity.get(session.activityId).then(ctrl.activity).then(function() {
              ctrl.activity().pages.map(function(activitypage, _i) {
                  // Retrieve document
                  PDFJS.getDocument("/media/" + activitypage.filename).then(function(pdf) {
                    ctrl.numPages()[activitypage.pageNumber] = pdf.numPages;
                    ctrl.docs()[activitypage.pageNumber] = {
                        page: {},
                        canvas: {},
                        canvasWidth: {},
                        canvasHeight: {},
                        virtualCanvasHeight: {},
                        totalRealHeight: 0,
                        canvasContents: {},
                        prevObjectState: {},
                        undoStack: []
                    };
                    

                    for(var i = 0, len = pdf.numPages; i < len; i++) {
                        (function(pn) {
                            var canvas = document.createElement('canvas');
                            pdf.getPage(pn + 1).then(function(page) {
                                var viewport = page.getViewport(pdfWidth / page.getViewport(1).width * 1);
                                canvas.height = viewport.height;
                                ctrl.docs()[activitypage.pageNumber].totalRealHeight += canvas.height;
                                ctrl.docs()[activitypage.pageNumber].virtualCanvasHeight[pn] = virtualPageWidth * viewport.height / viewport.width;
                                

                                canvas.width = viewport.width;

                                canvasctx = canvas.getContext("2d");
                                
                                page.render({canvasContext: canvasctx, viewport: viewport}).then(function() {
                                    ctrl.docs()[activitypage.pageNumber].page[pn] = canvas.toDataURL();
                                    ctrl.pageCount(ctrl.pageCount() + 1);


                                    m.redraw(true);
                                });
                            });
                        })(i);

                    }
                  });
              });
          });
      });
        ctrl.scrollPositions[args.user] = {};

        if(logAcceleration) {
            if(window.DeviceMotionEvent) {
                var accelcount = 0,
                    prevData = {};
                window.addEventListener("devicemotion", function(ev) {
                        var data = {
                            x: ev.accelerationIncludingGravity.x,
                            y: ev.accelerationIncludingGravity.y,
                            z: ev.accelerationIncludingGravity.z,
                            a: ev.rotationRate.alpha,
                            b: ev.rotationRate.beta,
                            g: ev.rotationRate.gamma
                        };

                        var absChange = {
                            x: (data.x - prevData.x < 0) ? (prevData.x - data.x) : (data.x - prevData.x),
                            y: (data.y - prevData.y < 0) ? (prevData.y - data.y) : (data.y - prevData.y),
                            z: (data.z - prevData.z < 0) ? (prevData.z - data.z) : (data.z - prevData.z),
                            a: (data.a - prevData.a < 0) ? (prevData.a - data.a) : (data.a - prevData.a),
                            b: (data.b - prevData.b < 0) ? (prevData.b - data.b) : (data.b - prevData.b),
                            g: (data.g - prevData.g < 0) ? (prevData.g - data.g) : (data.g - prevData.g)
                        };

                        // Only write to the log if the reading has changed significantly
                        if(absChange.x > 0
                                || absChange.y > 0
                                || absChange.z > 0
                                || absChange.a > 1 // threshold is one degree
                                || absChange.b > 1
                                || absChange.g > 1
                          ) {
                            args.connection.logOnly("accel." + args.user, data);
                            //console.log(++accelcount);
                        }
                            
                        prevData = data;
                    },
                    true
                );
            } else {
                console.warn("Device orientation logging not supported!");
            }
        }
        
        // Save pages as images
        ctrl.saveSnapshots = function(callback) {
            var pagesLeft = ctrl.pageCount();
            if(ctrl.docs()) {
                for(var _docNum in ctrl.docs()) {
                    var _doc = ctrl.docs()[_docNum].canvas;
                    var _contents = ctrl.docs()[_docNum].canvasContents;
                    for(var _pageNum in _doc) {

                        (function(doc, contents, docNum, pageNum) {
                            var origCanvas = doc[pageNum];
                            var tempFabricCanvas = new fabric.StaticCanvas();
                            tempFabricCanvas.setWidth(origCanvas.width || virtualPageWidth);
                            tempFabricCanvas.setHeight(origCanvas.height || virtualPageHeight);
                            tempFabricCanvas.objsByUUID = {}; // leave this
                            tempFabricCanvas.prevObjectState = {};
                            var canvContents = contents[pageNum];
                            if(canvContents) {
                                for(var i = 0, len = canvContents.length; i < len; i++) {
                                    ctrl.addObject(canvContents[i], tempFabricCanvas, true, false, "", true);
                                }
                            }

                            var exportCanvas = document.createElement('canvas');
                            exportCanvas.width = origCanvas.width;
                            exportCanvas.height = origCanvas.height;
                            var ctx = exportCanvas.getContext('2d');

                            // Get PDF
                            var pdfImage = new Image;
                            pdfImage.onload = function() {
                                ctx.drawImage(pdfImage, 0, 0, pdfImage.width, pdfImage.height, 0, 0, origCanvas.width, origCanvas.height);
                            
                                // Export image of drawn objects
                                var drawingImage = new Image;
                                drawingImage.onload = function() {
                                    ctx.drawImage(drawingImage, 0, 0, virtualPageWidth, virtualPageHeight);

                                    // Now upload as an image
                                    var snapshotUrl = exportCanvas.toDataURL();
                                    var data = new FormData();
                                    data.append("upload", snapshotUrl);
                                    m.request({
                                        method: "POST",
                                        url: '/api/v1/snapshot/' + args.session + '/' + args.user + '/' + docNum + '/' + pageNum,
                                        data: data,
                                        serialize: function(a) { return a; }
                                    }).then(function() {
                                        pagesLeft--;
										//console.log(pagesLeft);
                                        if((pagesLeft <= 0) && callback) {
											//console.log("finished saving pages " + callback);
                                            callback(); // run final callback
										}
                                    });
                                    
                                };
                                drawingImage.onerror = function() {
                                    console.error("Failed to load drawings while saving snapshot");
                                    pagesLeft--;
                                };
                                drawingImage.src = tempFabricCanvas.toDataURL();
                            };
                            pdfImage.onerror = function() {
                                console.error("Failed to load PDF image while saving snapshot");
                                pagesLeft--;
                            }
                            pdfImage.src = ctrl.docs()[docNum].page[pageNum];
                        })(_doc, _contents, _docNum, _pageNum);
                    }
                }
            } 
        };
      
      // Load own user data
      User.me().then(ctrl.me).then(function() {  
        // run snapshot saving every five minutes (students only)
        var myType = ctrl.me().type;
        if((myType == 2) || (myType == 'student') || (myType == 'Student'))
            ctrl.snapshotInterval = setInterval(ctrl.saveSnapshots, 5 * 60 * 1000);

        // Log that we've joined the group
        args.connection.logOnly("membershipChange", 
            Object.assign({}, ctrl.me(), {action: "load app"})
        );
    
        m.redraw();
    });

      realViewHeight = document.body.clientHeight;
      
      // set page and update group
      //if(!(args.user in ctrl.pageNumbers())) {
      //    ctrl.pageNumbers()[args.user] = 0;
      //    ctrl.setPage(0);
      //}

        if(!args.observerMode) {
            // Set up a network-disconnect message
            window.addEventListener('offline', function(e) {
                // console.log('offline', e);

                ctrl.offline(true);

                // setting errmsg triggers the error modal
                errmsg = "Probably Wi-Fi issues as usual.";
                // force synchronous redraw to show the modal
                m.redraw(true);
            });

            window.addEventListener('online', function(e) {
                // console.log('online', e);

                ctrl.offline(false);
                location.reload();

                setTimeout(function() {
                    // hide the error modal
                    errmsg = null;
                    m.redraw(true);

                    document.body.classList.remove('modal-open');
                    $('.modal-backdrop').remove();
                }, 5000);
            });
        }

      return ctrl;
    },
    view: function(ctrl, args) {
      var listener = function(e) {
      };

      var calcScroll = function(pageY) {
        var scrollbarElement = $('#scrollbar');
        var scrollDest = (pageY - scrollbarElement.offset().top) / scrollbarElement.height();
        if(scrollDest < 0)
            scrollDest = 0;
        else if(scrollDest > 1)
            scrollDest = 1;

        ctrl.setScroll(scrollDest);
      };


      return m("#main", {
          class: "errormodal-" + (errmsg ? "show" : "hide"),
          config: function(el) {
            ctrl.fireScrollEvent = false;
            el.scrollTop = parseInt(ctrl.getScroll(args.user, ctrl.pageNumbers()[args.user]) * (el.scrollHeight - window.innerHeight));
          
            document.addEventListener("mouseout", function(e) {
                if(!e.toElement && !e.relatedTarget)
                    if(ctrl.scrollDragging())
                        ctrl.scrollDragging(false);
            });

              // TODO remove?
            ctrl.setMainScroll = function(scroll) {
                el.scrollTop = parseInt(scroll * (el.scrollHeight - window.innerHeight));
                m.redraw();
                // console.log(el.scrollTop);
            };
 
          },
          onscroll: function(e) {
            var el = e.target;
            if (!ctrl.fireScrollEvent) {
              ctrl.fireScrollEvent = true;
              m.redraw.strategy("none");
              return false;
            }
            ctrl.setScroll(el.scrollTop / (el.scrollHeight - window.innerHeight));
          },
          onmousemove: function(e) {
            if(ctrl.scrollDragging())
                calcScroll(e.clientY);
          },
          onmouseup: function(e) {
            if(ctrl.scrollDragging()) {
                ctrl.scrollDragging(false);
                calcScroll(e.clientY);
            }
          }
        },

        errmsg ? m.component(ErrorModal, {message: errmsg}) : "",
        
        m.component(PDFViewer, ctrl),
        m.component(Scrollbar, ctrl),
        m.component(Controls, ctrl)
      );

    }
  };

    var ErrorModal = {
        controller: function(args) {
            return {
                showDetails: m.prop(false)
            };
        },
        view: function(ctrl, args) {
            var widthClasses = ".col-xs-8.col-xs-offset-2.col-sm-8.col-sm-offset-2.col-md-6.col-md-offset-3";
            return m(".modal.fade#error-modal", {
                    config: function(el) {
                        $("#error-modal").modal({
                            backdrop: "static"
                        });
                        $("#error-modal").modal("show");
                    }
                },
                m(".modal-content" + widthClasses,
                    m(".modal-header",
                        m("h4.modal-title", 
                            "Lost network connection"
                        )
                    ),
                    m(".modal-body",
                        m('p', 'The app will reload when network connectivity returns.')//,
                       
                       /* 
                        ctrl.showDetails()
                            ? m('p', 'Cause: ' + errmsg)
                            : m('a', {onclick: function() { ctrl.showDetails(true); }}, 'Details')
                        */
                    )//,
                    /*
                    m(".modal-footer",
                        m("button.btn.btn-danger.pull-right", {
                                onclick: location.reload.bind(location),
                            },
                            "Reload"
                        )
                    )
                    */
                )
            );
        }
    };

  var Controls = {
    view: function(__, args) {
      var changePage = function(doc, newDoc) {
          var currentDocument = args.pageNumbers()[args.user] || 0;
          args.setSelectionBox(null, currentDocument, args.pageNum);
          
        //   console.log("change page!");
          args.saveCanvases(doc);   // Save contents of all canvases
          $('.canvas-container').remove();  // Remove canvases from DOM
          args.lastDrawn({});   // Signal that we need to change PDFs
          args.pageNumbers()[args.user] = newDoc; // Set the local page number
          m.redraw();   // Rebuild canvases
          args.setPage(newDoc); // Notify group of page change
      };
      args.changePage = changePage;

      var changePageCB = function(doc, newDoc, callback) {
        var currentDocument = args.pageNumbers()[args.user] || 0;
        args.setSelectionBox(null, currentDocument, args.pageNum);
        
      //   console.log("change page!");
        args.saveCanvases(doc);   // Save contents of all canvases
        $('.canvas-container').remove();  // Remove canvases from DOM
        args.lastDrawn({});   // Signal that we need to change PDFs
        args.pageNumbers()[args.user] = newDoc; // Set the local page number
        m.redraw();   // Rebuild canvases
        args.setPage(newDoc); // Notify group of page change
        callback();
    };

      args.users_list = args.userList();

      var changeUser = function (student_id) {
        if (student_id){
            args.sel_user = parseInt(student_id);
        }
        var doc = args.pageNumbers()[args.user];
        if(doc > 0){
            changePageCB(doc, doc - 1, function () {
                // var doc2 = args.pageNumbers()[args.user];
                // changePage(doc2, doc2 + 1);
                console.log("page 1")
            });
        }
        else if(doc < (args.activity().pages.length - 1)){
            changePageCB(doc, doc + 1, function () {
                // var doc2 = args.pageNumbers()[args.user];
                // changePage(doc2, doc2 - 1);
                console.log("page 2")
            });
        }
      }

      args.changeUser = changeUser;

      var pageNum = args.pageNumbers()[args.user];
      if(typeof(pageNum) == 'undefined') {
          pageNum = 0;
      }

      return m("#controls", {
          style: "background-color: " + args.myColor()
        },
        // Previous page button
        m("img.tool-icon", {
            onclick: function() {
                var doc = args.pageNumbers()[args.user];
                if(doc > 0)
                    changePage(doc, doc - 1);
            },
            draggable: false,
            src: "/shared/icons/Icons_F_Left_W.png"
        }, "Prev"),
        
        // Specific page buttons
        (args.activity() ? 
        args.activity().pages.map(function(page) {
            var usersHere = [];
            
            args.userList().map(function(user) {
                if(args.pageNumbers()[user.id] == page.pageNumber)
                    usersHere.push(m("p.user-dot", {style: "color: " + 
                            args.userColor(user.id)
                        }, m.trust("&#9679;")));
            });
            
            var samepage = (page.pageNumber == args.pageNumbers()[args.user]);
            return [m("img.tool-icon", {
                    onclick: function() {
                        if(args.pageNumbers()[args.user] != page.pageNumber)
                            changePage(args.pageNumbers()[args.user], page.pageNumber);
                    },
                    draggable: false,
                    // Use the filled-in circle if it's the current page
                    src: samepage
                        ? "/shared/icons/Icons_F_Selected Circle_W.png"
                        : "/shared/icons/Icons_F_Deselect Circle_W.png"
                }, page.pageNumber),
                samepage ? "" : m("div.tiny-page-marker-div", usersHere)];
        })
        : ""),
        // Next page button
        m("img.tool-icon", {
            onclick: function() {
                var doc = args.pageNumbers()[args.user];
                if(doc < (args.activity().pages.length - 1))
                    changePage(doc, doc + 1);
            },
            draggable: false,
            src: "/shared/icons/Icons_F_Right_W.png"
        }, "Next"),

        /*
          m("span", {
              style: "position: absolute; left: 45vw; color: white; font-size: large"
              }, 
              m.trust(args.title())
          ),
          */

            m.component(OptionsTray, args),
            
            m("img.tool-right.pull-right#undo", {
                onmousedown: args.undo,
                draggable: false,
                //ontouchend: args.undo
                // Gray out the icon if we can't undo
                src: args.allowUndo()[args.pageNumbers()[args.user]]
                    ? "/shared/icons/Icons_F_Undo_W.png"
                    : "/shared/icons/Icons_F_Undo.png"
            }),

          
            m("img.tool-right.pull-right#pointer-tool", {
                onmousedown: function() {
                    args.setTool(3);
                },
                draggable: false,
                src: (args.tool() == 3) ? "/shared/icons/Icons_F_Pointer_W_Filled.png" : "/shared/icons/Icons_F_Pointer_W.png"
            }),


            m("img.tool-right.pull-right#eraser-tool", {
                onmousedown: function() {
                    args.setTool(2);
                },
                draggable: false,
                src: (args.tool() == 2) ? "/shared/icons/Icons_F_Erase_W_Filled.png" : "/shared/icons/Icons_F_Erase_W.png"
            }),
            
            // Draw a circle to indicate pen color
            m("p.tool-right.pull-right#pen-color-indicator", {
                    style: "color: " + penColors[args.penColorIdx()]
                },
                m.trust("&#9679;")
             ),
            
            m("img.tool-right.pull-right#pen-tool", {
                onclick: function() {
                    // If we're already using the pen tool, change the color
                    if(args.tool() == 0) {
                        args.setPenColor((args.penColorIdx() + 1) % penColors.length);
                    }
                    args.setTool(0);
                },
                draggable: false,
                src: (args.tool() == 0) ? "/shared/icons/Icons_F_Pen_W_Filled.png" : "/shared/icons/Icons_F_Pen_W.png"
            }),

            args.me() ?
                (args.me().type != 2) ?
                    m("img.tool-right.pull-right", {
                        onclick: function() {
                            console.log(args.userList());
                            if (document.getElementById("users_tray").className == "tray_users_open") {
                                document.getElementById("users_tray").className = "tray_users";
                            }
                            else {
                                var rect = this.getBoundingClientRect();
                                document.getElementById("users_tray").className = "tray_users_open";
                                document.getElementById("users_tray").style.marginLeft = rect.left + 'px';
                            }
                        },
                        draggable: false,
                        src: "/shared/icons/Icons_F_Edit_W.png"
                    })
                : m("div", {style: "display:none"})
            :m("div", {style: "display:none"}),

            m("div.tray_users", { 
                id: "users_tray"
             },
            (args.users_list.length > 1 ?
                m("table", 
                    (args.users_list.map(function(user) {
                        if (user.type != 2) {
                            return ""
                        }
                        var netid = user.email.split('@')[0];
                        if (netid.length > 10) {
                            netid =  netid.substring(0, 4) + '....' + netid.substring(netid.length - 4);
                        }
                        var colors = args.userColors();
                        return m("tr", {style: "background: " + colors[user.id]},
                            m("td.left",
                                m("input[type=checkbox]", {
                                    name: "emails",
                                    value: user.id,
                                    onclick: function () {
                                        if (this.checked) {
                                            var checkboxes = document.getElementsByName('emails')
                                            for (var i = 0, n = checkboxes.length; i < n; i++) {
                                                checkboxes[i].checked = false;
                                            }
                                            this.checked = true;
                                            changeUser(this.value);
                                        }
                                        else {
                                            changeUser(-1);
                                        }
                                    }
                                })
                            ),
                            m("td",
                                m("p", netid)
                            )
                        )
                    }))
                )
                :
                m("p.no-active", "no active users"))
            ),

          
          // Only show the objects menu if we're on a sketch page
          (args.activity() ? 
            (args.activity().pages[pageNum].metadata.hasFBD) ? 
                m.component(MechanicsObjectSelect, args) 
            : ""
          : "")
       
          /*
          m("h3.name-text.pull-right", {
              style: "color: " + getUserColor(args.userList(), args.user.id)
            },
            m.trust("&#9679;")
          ),*/

      );
    }
  };

  var OptionsTray = {
    controller: function(args) {
        return {
            open: m.prop(false)
        };
    },
    view: function(ctrl, args) {
        return m("div.tool-button.tool-right.pull-right", {
                style: "color: white; padding-right: 10px;",
                onclick: m.redraw
            },
            m("img", {
                    width: 32,
                    height: 32,
                    src: "/shared/icons/Icons_F_Dropdown_W.png",
                    draggable: false,

                    onclick: function(e) {
                        ctrl.open(!ctrl.open());
                    }
                    /*,
                    ontouchstart: function() {
                        ctrl.open(!ctrl.open());
                    }
                    /*
                    ontouchend: function() {
                        ctrl.open(!ctrl.open());
                    },
                    */
                }
            ),
            m("div#options-tray", {
                    style: "right: -1vw; position: absolute; text-align: center", 
                    class: ctrl.open() ? "tray-open" : "tray-closed"
                },

                // Tray contents here!
                m("button.btn.btn-info.mech-obj-button", {
                        onclick: function() {
                            // Log that we've joined the group
                            args.connection.logOnly("membershipChange", 
                                Object.assign({}, args.me(), {action: "leave app (clicked reload/exit button)"})
                            );
                            
                            if(args.me().type == 2) {
//                                args.exitCallback(function() {
//									console.log("Reload");
                                    location.reload(true);
//                                });
                            } else {
                                args.exitCallback();
                            }
                        }
                    },
                            args.me() ?
                                (args.me().type != 2) ?
                                    "Exit"
                                : "Reload"
                            : "Reload"
                )
            )
        );
    }
  };
  
    
  var MechanicsObjectSelect = {
    controller: function(args) {
      var ctrl = {
        open: m.prop(false),

          // this is dumb
        recalcOffset: function() {
            // The element at the center of the screen is the upper canvas, 
            // so the previousSibling is the lower canvas with id information
            var canvasElement = document.elementFromPoint(
                50,
                document.body.clientHeight / 2
            ).previousSibling;

            // Get the fabric canvas based on the id
            var canvInfo = args.parseCanvasId(canvasElement.id);
            ctrl.canvas = args.docs()[canvInfo.doc].canvas[canvInfo.page];
            
            // Get the vertical offset so new objects will be created at the
            // center of the window
            if(ctrl.canvas) {
                var jqCanvasElement = $(canvasElement);
                ctrl.left = ctrl.canvas.width / 2;
                ctrl.top = document.body.clientHeight / 2 - jqCanvasElement.offset().top;
                // vertical scrolling only so don't bother with left offset

                // Randomly move a bit so that new objects aren't drawn exactly over each other
                var nudge = Math.random() * 100 - 50;
                ctrl.left += nudge;
                ctrl.top += nudge;
            }
        },

          canvas: null,

          // object properties (just guesses for now!)
          left: 0, // left and top to be set in recalcOffset
          top: 0,
          distURange: 200,
          distTRange: 200,
          gridsize: 30,
          arrowLength: 80,
          
          // triangular arrow lengths
          minThickness: 5,
          maxThickness: 50,
        
          strokeWidth: 4,
          handleRadius: 8 
      };
      return ctrl;
    },
    view: function(ctrl, args) {
      return m("div.tool-button.tool-right.pull-right", {
          style: "color: white; padding-right: 10px;",
          onclick: m.redraw
        },
        m("div.mechanics-objects-holder", {
                    onclick: function(e) {
                        ctrl.open(!ctrl.open());
                    }
        },
        "Tools"
        ),
        m("div#mech-objs-tray", {
            style: "width: 25vw; left: -5vw",
          class: ctrl.open() ? "tray-open" : "tray-closed",
          onclick: function() {
              args.tool(3); // Use finger tool after adding object
          }
        },

        m("strong.mechitem", "Rod"),
        m("p.mechitem",
            m("button.btn.btn-info.mech-obj-button#addRod", {
                    title: "Add rod",
                    onclick: function() {
                        ctrl.recalcOffset();
                        args.addObject(
                            {
                                type: "Rod",
                                left: ctrl.left,  
                                top: ctrl.top, 
                                width: 4 * ctrl.arrowLength,
                                height: 40
                            },
                            ctrl.canvas, true, true, "addFBDObject"
                        );
                    }
                }, 
                m("img", {
                    src: "/shared/icons/Rod.png",
                })
            )
        ),
            
        m("strong", "Concentrated Force"),
        m("p",
            m("button.btn.btn-info.mech-obj-button#addArrow", {
                    title: "Add concentrated force arrow",
                    onclick: function() {
                        var angle = 0;
                        ctrl.recalcOffset();
                        args.addObject(
                            {
                                type: "Arrow",
                                left: ctrl.left,  
                                top: ctrl.top, 
                                width: 2 * ctrl.arrowLength,
                                angle: angle, 
                                stroke: 'green',
                                strokeWidth: 4, 
                                originX: 'center', 
                                originY: 'center',
                                padding: 5 
                            },
                            ctrl.canvas, true, true, "addFBDObject"
                        );
                    }
                }, 
                m("img", {
                    src: "/shared/icons/FR.png"
                })
            )
        ),


        m("strong", "Distributed Load"),
        m("p", 
            ["DUU", "DUD"].map(function(letters) {
                    return m("button.btn.btn-info.mech-obj-button#add" + letters, {
                            title: "Add uniform distributed load arrows",
                            onclick: function() {
                                var angles = {DUU: -90, DUD: 90};
                                //var angles = {DUU: 0, DUD: 180};
                                ctrl.recalcOffset();
                                args.addObject(
                                    {
                                        type: "DistUnifLoad",
                                        left: ctrl.left, 
                                        top: ctrl.top,
                                        arrowAngle: angles[letters],
                                        range: ctrl.distURange, 
                                        thickness: ctrl.arrowLength,  
                                        spacing: ctrl.gridsize
                                    },
                                    ctrl.canvas, true, true, "addFBDObject"
                                );
                            }
                        }, 
                        m("img", {
                            src: "/shared/icons/" + letters + ".png"
                        })
                    );
                }
            )
        ),
        m("p", 
            ["DTUA", "DTDA", "DTUD", "DTDD"].map(function(letters) {
                    return m("button.btn.btn-info.mech-obj-button#add" + letters, {
                            title: "Add triangular distributed load arrows",
                            onclick: function() {
                                var angles = {DTUA: -90, DTUD: -90, DTDA: 90, DTDD: 90};
                                var flipped = {DTUA: false, DTUD: true, DTDA: false, DTDD: true};
                                ctrl.recalcOffset();
                                args.addObject(
                                    {
                                        type: "DistTrianLoad",
                                        left: ctrl.left, 
                                        top: ctrl.top, 
                                        range: ctrl.distTRange, 
                                        thickness: ctrl.arrowLength / 4, 
                                        arrowAngle: angles[letters], 
                                        spacing: ctrl.gridsize,
                                        flipped: flipped[letters],
                                        minThickness: ctrl.minThickness,
                                        maxThickness: ctrl.maxThickness
                                    },
                                    ctrl.canvas, true, true, "addFBDObject"
                                );
                            }
                        }, 
                        m("img", {
                            src: "/shared/icons/" + letters + ".png"
                        })
                    );
                }
            )
        ),
        
        m("strong", "Moment"),
        m("p", 
            ["MC", "MCC"].map(function(letters) {
                    return m("button.btn.btn-info.mech-obj-button#add" + letters, {
                            title: "Add moment",
                            onclick: function() {
                                ctrl.recalcOffset();
                                args.addObject(
                                    {
                                        type: "Arc",
                                        left: ctrl.left, 
                                        top: ctrl.top,    
                                        width: 2 * ctrl.arrowLength, 
                                        height: 2 * ctrl.arrowLength, 
                                        radius: ctrl.arrowLength, 
                                        clockwise: (letters == "MC"),
                                    },
                                    ctrl.canvas, true, true, "addFBDObject"
                                );
                            }    
                        }, 
                        m("img", {
                            src: "/shared/icons/" + letters + ".png"
                        })
                    );
            })
        ),
        
        // Line and curve objects sometimes shouldn't be available
        showVMLines ? m("strong", "V and M Lines") : "",
        showVMLines ? m("p",
            m("button.btn.btn-info.mech-obj-button#addControlledLine", {
                    title: "Add line",
                    onclick: function() {
                        ctrl.recalcOffset();
                        args.addObject(
                            {
                                type: "ControlledLine",
                                x1: ctrl.left,
                                y1: ctrl.top,
                                x2: ctrl.left + 50,
                                y2: ctrl.top + 50,
                                handleRadius: ctrl.handleRadius,
                                strokeWidth: ctrl.strokeWidth,
                            },
                            ctrl.canvas, true, true, "addFBDObject"
                        );
                    }
                }, 
                m("img", {
                    src: "/shared/icons/ControlledLine.png"
                })
            ),
            m("button.btn.btn-info.mech-obj-button#addQuadratic", {
                    title: "Add curve",
                    onclick: function() {
                        ctrl.recalcOffset();
                        args.addObject(
                            {
                                x1: ctrl.left,
                                y1: ctrl.top,
                                x2: ctrl.left + 50,
                                y2: ctrl.top + 50,
                                x3: ctrl.left + 100,
                                y3: ctrl.top + 100,
                                handleRadius: ctrl.handleRadius,
                                strokeWidth: ctrl.strokeWidth,
                                name: "controlCurvedLine"
                            },
                            ctrl.canvas, true, true, "addFBDObject"
                        ); 
                    }    
                }, 
                m("img", {
                    src: "/shared/icons/CurvedControlledLine.png"
                })
            )
        ) : ""
        
        )
      );
    }
  };

  var Scrollbar = {
      controller: function(args) {
          var ctrl = {
              scrollbarHeight: m.prop(null),
              scrollbarTop: m.prop(0),
              dragging: m.prop(false),
              setScroll: function(e) {
                  var scrollDest = e.offsetY / ctrl.scrollbarHeight();
                //   console.log(scrollDest);
                  if((typeof(scrollDest) == 'number') && (scrollDest >= 0) && (scrollDest <= 1)) {
                    setTimeout(
                        function(){
                            args.setScroll(scrollDest);
                        }, 
                    200);
                  }
              }
          };

          return ctrl;
      },
      view: function(ctrl, args) {
          var barTop = ctrl.scrollbarTop();
          return m("svg.scrollbar#scrollbar", {
                  config: function(el, isInit) {

                      /*
                      if(isInit) {
                          return;
                      }
                      */
                      ctrl.scrollbarHeight(el.clientHeight);
                      ctrl.scrollbarTop(el.getBoundingClientRect().top);
                  },
                  onmousedown: function(e) {
                      args.scrollDragging(true);
                      ctrl.setScroll(e);
                  },
                  /*onmousemove: function(e) {
                      if(ctrl.dragging())
                          ctrl.setScroll(e);
                  },
                  onmouseup: function(e) {
                      ctrl.dragging(false);
                      ctrl.setScroll(e);
                  }*/
                  ontouchstart: function(e) {
                    //   console.log(e);
                      var touch = e.touches[0];
                      e.offsetY = touch.pageY - ctrl.scrollbarTop();// + window.scrollY;
                      ctrl.setScroll(e);
                  },
                  /*
                  ontouchend: function(e) {
                      var touch = e.touches[0];
                      e.offsetY = touch.pageY - touch.target.getBoundingClientRect().top;// + window.scrollY;
                      ctrl.setScroll(e);
                  },
                  */
                  ontouchmove: function(e) {
                      var touch = e.touches[0];
                        e.offsetY = touch.pageY - ctrl.scrollbarTop();// + window.scrollY;
                        ctrl.setScroll(e);
                      
                  }
              },
              args.userList().map(function(user) {
                  // Draw circle on scroll bar if the user is on our page.
                  if(args.pageNumbers()[user.id] == args.pageNumbers()[args.user]) {
                      return m.component(ScrollbarCircle, {
                          scrollPositions: args.scrollPositions,
                          setScroll: args.setScroll,
                          getScroll: args.getScroll,
                          user: user,
                          dragging: ctrl.dragging,
                          color: args.userColor(user.id),
                          userList: args.userList,
                          pointerEvents: args.user === user.id,
                          scrollbarHeight: ctrl.scrollbarHeight,
                          pageNumber: args.pageNumbers()[args.user]
                      });
                  } else {
                      return "";
                  }
              }),
              "Scrollbar"
          );
      }
  };

  var ScrollbarCircle = {
    controller: function(args) {
        return {
            radius: 19
        };
    },
    view: function(ctrl, args) {
        // TODO 
        var scrollPosition = args.getScroll(args.user.id, args.pageNumber); 
        return m("circle.scrollbar-circle", {
            cx: "" + ctrl.radius + "px",
            cy: "" + (ctrl.radius + (args.scrollbarHeight() - 2 * ctrl.radius) * scrollPosition) + "px",
            r: "" + ctrl.radius + "px",
            fill: args.color, //getUserColor(args.userList(), args.user.id),
            stroke: "none"
        }, "");
    }
  };
    
    var PDFViewer = {
        controller: function(args) {
            return {
                interactable: null
            };
        },
        view: function(ctrl, args) {
            //return m("#pdf-container", drawPDF(ctrl, args, 1));
            var pageNum = args.pageNumbers()[args.user] || 0;
            return m("#pdf-container", 
                Array.apply(null, {length: args.numPages()[pageNum]}).map(function(__, i) {
                    // console.log('page '+i);
                    return m.component(PDFPageHolder, Object.assign({}, args, {pageNum: i}));
                })
            );
        }
    };
  
    var PDFPageHolder = {
    controller: function(args) {
      var ctrl = {
        canvas: null,
          // TODO use docIdx everywhere
        docIdx: args.pageNumbers()[args.user],
        erasing: false,
        fingerScrolling: m.prop(false),
        selecting: false,
        setPen: function() {
            if(!ctrl.canvas || ctrl.canvas._isCurrentlyDrawing)
                return;

            ctrl.canvas.isDrawingMode = true;
            ctrl.canvas.freeDrawingBrush = new fabric.PencilBrush(ctrl.canvas);
            ctrl.canvas.freeDrawingBrush.opacity = 1.0;
            ctrl.canvas.freeDrawingBrush.color = penColors[args.penColorIdx()];
            
            // Try to improve performance
            ctrl.canvas.selection = false;
        },
        setTool: function() {
            if(!ctrl.canvas)
                return;

                ctrl.erasing = false;

                var toolId = args.tool();
                if(toolId == 0) {
                    // pen tool
                    ctrl.setPen();
                } else if(toolId == 1) {
                    // highlighter tool
                    ctrl.setPen();
                    ctrl.canvas.freeDrawingBrush.opacity = 0.5;
                } else if(toolId == 2) {
                    ctrl.canvas.isDrawingMode = false;
                    ctrl.canvas.selection = true;
                    ctrl.erasing = true;
                    ctrl.canvas.selectionColor = 'rgba(255, 0, 0, 0.3)';

                } else if(toolId == 3) {
                    // pointer tool
                    ctrl.canvas.selection = true;
                    ctrl.canvas.isDrawingMode = false;
                    ctrl.canvas.selectionColor = 'rgba(100, 100, 255, 0.3)';
                }

        },

        deleteSelected: function() {
            if(!ctrl.canvas)
                return;

            var activeObject = ctrl.canvas.getActiveObject(),
                activeGroup = ctrl.canvas.getActiveGroup();


            if(activeObject) {
                args.removeObject(activeObject, ctrl.canvas, true, true, "removeObject");
            }

            if(activeGroup) {
                var objects = activeGroup.getObjects();
                ctrl.canvas.discardActiveGroup();
                var groupID = uuidv1();
                objects.forEach(function(obj) {
                    obj.groupID = groupID;
                    args.removeObject(obj, ctrl.canvas, true, true, "removeObject");
                });
            }
        },

        setSelectionBox: function(userId, box) {
            if(userId != args.user) {
                var rect = ctrl.canvas.selectionBoxes[userId];
                if(rect) {
                    rect.set(box);
                } else {
                    var boxOptions = Object.assign(box, {
                        fill: makeRGBA(args.userColor(userId), 0.3),
                        selectable: false,
                        excludeFromExport: true
                    });
                    var newRect = new fabric.Rect(boxOptions);
                    ctrl.canvas.add(newRect);
                    ctrl.canvas.selectionBoxes[userId] = newRect;
                }

                // Prevent selecting an object someone else is selecting
                //console.log(box);
                for(var i = 0, len = box.contents.length; i < len; i++) {
                    var canvasObj = ctrl.canvas.objsByUUID[box.contents[i]];
                    if(canvasObj)
                        canvasObj.selectable = !(box.visible);
                }

                ctrl.canvas.renderAll();
            }
        }

      };

        // for reloading objects on the current page for a store change
        ctrl.loadCanvasContents = function(contents) {
            ctrl.canvas.objsByUUID = {};
            if(contents) {
                for(var i = 0, len = contents.length; i < len; i++)
                    args.addObject(contents[i], ctrl.canvas, true, false);
            }
        };

        // after we receive a 'set-store' message, clear canvas and add objects
        ctrl.setStoreCallback = function() {
            ctrl.canvas.clear();
            var contents = args.docs()[ctrl.docIdx].canvasContents[args.pageNum];
            // console.log(contents);
            ctrl.loadCanvasContents(contents);
        };

      return ctrl;
    },
    view: function(ctrl, args) {

      var currentDocument = args.pageNumbers()[args.user] || 0;
      var canvasId = args.getCanvasId(currentDocument, args.pageNum);
      var doc = args.docs()[currentDocument];

      return m("div.pdf-page-holder",
        m("img.pdf-page", {
          onload: m.redraw,
          config: function(el, isInit) {
            if(doc && doc.page[args.pageNum] && ((typeof args.lastDrawn()[args.pageNum]) === "undefined")) {
                el.src = doc.page[args.pageNum];
                args.lastDrawn()[args.pageNum] = true;

                var docs = args.docs();
                docs[currentDocument].canvasWidth[args.pageNum] = el.clientWidth;
                docs[currentDocument].canvasHeight[args.pageNum] = el.clientHeight;

                // console.log(el.clientWidth, el.clientHeight, el.clientHeight / el.clientWidth);
                args.docs(docs);
            }
          }
        }),
        
        m("div.drawing-surface", {
                config: function(el, isInit) {
                    if(isInit)
                        return;

                    // We capture these touch events so that drawing mode can be turned off while 
                    // the user is finger-scrolling.
                    el.addEventListener(
                        "touchstart",
                        function(e) {
                            /*
                            if(ctrl.canvas)
                                ctrl.canvas.isDrawingMode = false;
                            */
                            e.preventDefault();
                        },
                        true
                    );
                    el.addEventListener(
                        "touchend",
                        function(e) {
                            /*
                            if(ctrl.canvas) {
                                //ctrl.canvas.isDrawingMode = (args.tool() == 1);
                                ctrl.setTool();
                            }
                            */
                            e.preventDefault();
                        },
                        true
                    );
                    
                },
            },
            

            m("canvas.drawing-surface", {
                onbeforeunload: function() {
                    args.removeSetStoreCallback(ctrl.setStoreCallback);
                },
                config: function(el, isInit) {
                    if(ctrl.canvas)
                        ctrl.canvas.undoStack = doc.undoStack;
                    if(isInit) {
                        ctrl.setTool();
                        return;
                    } 
                    
                    var docs = args.docs();

                    ctrl.canvas = new fabric.Canvas(canvasId, {
                        isDrawingMode: ((args.tool() == 0) || (args.tool() == 1)),
                        allowTouchScrolling: true,
                        doc: currentDocument,
                        page: args.pageNum
                    });
                    args.docs()[currentDocument].canvas[args.pageNum] = ctrl.canvas;
                    //console.log("made canvas" + args.pageNum);

                    ctrl.canvas.pushUndo = function(undoObj) {
                        if(ctrl.canvas.undoStack) {
                            if(undoObj.toObject)
                                undoObj = undoObj.toObject(['uuid', 'groupID']);
                            undoObj.page = args.pageNum;
                            ctrl.canvas.undoStack.push(undoObj);
                        }
                    };
                    ctrl.canvas.prevObjectState = doc.prevObjectState;

                    // Use the same coordinate system as all other users but scale to 
                    // the size of the page.
                    ctrl.canvas.setWidth(virtualPageWidth);


                    var vheight = args.docs()[currentDocument].virtualCanvasHeight[args.pageNum];
                    if(vheight)
                        ctrl.canvas.setHeight(vheight);
                    else
                        ctrl.canvas.setHeight(virtualPageHeight);
                    ctrl.canvas.setDimensions({
                            width: "100%",
                            height: "100%"
                        }, {
                            cssOnly: true
                        }
                    );

                    // Load canvas data if any
                    var contents = docs[currentDocument].canvasContents[args.pageNum];
                    ctrl.loadCanvasContents(contents);

                    args.flushUpdateQueue(args.pageNumbers()[args.user], args.pageNum);
                    
                    // Set selections
                    ctrl.canvas.selectionBoxes = {};
                    ctrl.canvas.setSelectionBox = ctrl.setSelectionBox;
                    if(args.connection && args.connection.store) {
                        for(var userId in args.connection.store.selectionBox) {
                            var box = args.connection.store.selectionBox[userId];
                            if(box.doc == currentDocument && box.page == args.pageNum)
                                ctrl.setSelectionBox(userId, box);
                        }
                    }
                    
                    // If we receive set-store, clear contents and update
                    args.addSetStoreCallback(ctrl.setStoreCallback);

                    // Use the right tool
                    ctrl.setTool();

                    // Set up event handlers
                    ctrl.canvas.on({

                        // Enforce scaling limits
                        "object:scaling": function(e) {
                            var scaleX = e.target.scaleX,
                                scaleY = e.target.scaleY;
                            e.target.set({
                                scaleX: (scaleX < minScaleX) ? minScaleX
                                    : (scaleX > maxScaleX) ? maxScaleX
                                        : scaleX,
                                scaleY: (scaleY < minScaleY) ? minScaleY
                                    : (scaleY > maxScaleY) ? maxScaleY
                                        : scaleY
                            });
                        },

                        "object:modified": function(e) {
                            if (!(e.target.uuid in ctrl.canvas.objsByUUID) && e.target.type != "group") {
                                return;
                            }
//                                delete canvas.objsByUUID[obj.uuid];
                            if(e.target.excludeFromExport) {
                                e.target = e.target.target;
                            }
                                    
                            if(e.target.type == "circle") {
                                return;
                            }

                            if(e.target.type == "group") {
                                var groupID = uuidv1();
                                var objects = e.target.getObjects();

                                for(var i = 0; i < objects.length; i++) {
                                    var obj = objects[i];
                                    obj.groupID = groupID;
                                    
                                    if(obj.target) {
                                        var frozen = args.serializeObject(obj),
                                            origX = obj.left,
                                            origY = obj.top;
                                        obj.left = frozen.left;
                                        obj.top = frozen.top;
                                        obj.trigger('modified');
                                        obj.left = origX;
                                        obj.top = origY;
                                    }
                                    var newevent = {target: obj, skipSelection: true, removed: false};
                                    ctrl.canvas.trigger("object:modified", newevent);
                                    if(newevent.removed)
                                        i--;
                                }

                                if(objects.length == 0)
                                    ctrl.canvas.trigger('selection:cleared');

                            } else if((e.target.type == "DistUnifLoad") || (e.target.type == "DistTrianLoad")) {
                                // Show new position and scale
                                //console.log(e.target);
                                if(e.target.group) {
                                    var frozen = args.serializeObject(e.target);
                                    var origScaleX = e.target.group.scaleX;
                                    e.target.group.removeWithUpdate(e.target);
                                    e.target.scaleX = origScaleX;
                                    //e.target.set({left: frozen.left, top: frozen.top});
                                    e.removed = true;
                                }
                                
                                var origLeft = e.target.left - e.target.diffLeft,
                                    origTop = e.target.top - e.target.diffTop,
                                    uuid = e.target.uuid;
 
                                if(e.target.scaleX != 1.0) {
                                    // console.log(e.target.range, e.target.scaleX, e.target.width);
                                    e.target.range = e.target.scaleX * e.target.width;
                                    e.target.scaleX = 1.0;
                                }

                                e.target.forEachObject(e.target.remove.bind(e.target));
                                e.target.left = origLeft;
                                e.target.top = origTop;

                                e.target.initialize(e.target);
                                e.target.setCoords();
                                args.modifyObject(e.target, ctrl.canvas, false, true, "modifyFBDObject");

                            } else {
                                args.modifyObject(e.target, ctrl.canvas, false, true, "modifyObject");
                            }

                            // Update selection box if we haven't already
                            if(!e.skipSelection){
                                var parammod = e.target.getBoundingRect();
                                if (e.target.type == "group"){
                                    parammod.objects = e.target.getObjects();
                                }
                                else{
                                    parammod.uuid = e.target.uuid;
                                }
//                                args.setSelectionBox(e.target.getBoundingRect(), currentDocument, args.pageNum);
                                args.setSelectionBox(parammod, currentDocument, args.pageNum);
                            }
                                

                        },
                        "path:created": function(e) {
                            args.addObject(e.path, ctrl.canvas, false, true, "addFreeDrawing");
                        },

                        "selection:cleared": function(e) {
                            args.setSelectionBox(null, currentDocument, args.pageNum);
                        },

                        // erasing
                        "object:selected": function(e) {
                            if(ctrl.erasing) {
                                ctrl.deleteSelected();
                            } else {
                                var obj = e.target;
                                args.setSelectionBox({
                                        left: obj.left - (obj.width / 2),
                                        top: obj.top - (obj.height / 2),
                                        angle: obj.angle,
                                        width: obj.width,
                                        height: obj.height,
                                        uuid: obj.uuid
                                    },
                                    currentDocument, 
                                    args.pageNum
                                );
                                
                                e.target.on('mousedown', function(e) {
                                    if(ctrl.erasing)
                                        ctrl.deleteSelected();
                                });
                            }
                        },
                        "selection:created": function(e) {
                            //console.log(e);
                            //e.target.hasControls = false;
                            if(ctrl.erasing) {
                                ctrl.deleteSelected();
                            } else {

                                args.setSelectionBox({
                                        left: e.target.left,
                                        top: e.target.top,
                                        width: e.target.width,
                                        height: e.target.height,
                                        angle: e.target.angle,
                                        objects: e.target.getObjects()
                                    },
                                    currentDocument, 
                                    args.pageNum
                                );

                                e.target.on('mousedown', function(e) {
                                    if(ctrl.erasing)
                                        ctrl.deleteSelected();
                                });
                            }
                        }

                    });

                    // save out data
                    args.docs(docs);
                },
                id: canvasId
            })
        )
      );
    }
  };
});
