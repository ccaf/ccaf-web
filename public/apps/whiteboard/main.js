define(["exports", "pdfjs-dist/build/pdf.combined", "mithril", "interact", "css", "userColors"], function(exports, pdfjs, m, interact, css, userColors) {
  var PDFJS = pdfjs.PDFJS;
  var array;
  exports.load = function(connection, el, params) {
    array = connection.array;
    css.load("/apps/whiteboard/styles.css");
    var ctrl = m.mount(el, m.component(Main, {
      pdf: params.pdf,
      user: params.user.id,
      session: params.session.id,
      connection: connection
    }));

    connection.addObserver(function(store) {
      if (store.scrollPositions) {
        ctrl.scrollPositions(store.scrollPositions || {});
      }
      ctrl.remotePages(store.pages || {});
      requestAnimationFrame(m.redraw);
    });

    window.addEventListener("resize", m.redraw.bind(null, true));
  };

  var colors = {
    0: "#000000",
    1: "#FF0000",
    2: "#00FF00",
    3: "#0000FF",
    4: "#FFFFFF"
  };

    
    // size and position of page completion check boxes
    var completionX = 50,
        completionY = 50,
        completionW = 50,
        completionH = 50,
        completionBoxColor = 'orange';
    

    function drawPageCompletionMarker(pn, isComplete) {
        
        var box = document.getElementById('completionbox' + pn);
        console.log("Here: ", box);
        if(!box)
            return;
        if(isComplete) {
            box.setAttribute("fill", "black");
        } else {
            box.setAttribute("fill", "transparent");
        }
    };


  function dist(x1, y1, x2, y2) {
    var d = Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
    return d;
  }

  var Main = {
    controller: function(args) {
      var ctrl = {
        numPages: m.prop(0),
        scrollPositions: m.prop({}),
        scroll: m.prop("open"),
        pages: [],
        pagesComplete: {},
        remotePages: m.prop({}),
        currentPath: null,
        currentPage: null,
        drawn: m.prop([]),
        pdf: m.prop(null),
        tool: m.prop(0),
        color: {0: 0, 1: 0},
        size: m.prop(10),
        fireScrollEvent: true,
        lastX: 0,
        lastY: 0,
        curId: 0,
        user: args.user,
        session: args.session,
        userList: m.prop([]),
        markPageComplete: function(pagenum, isComplete) {
            args.connection.transaction([["pageComplete"]], function(pageCompletion) {
                pageCompletion.u = args.user;
                pageCompletion.s = args.session;
                pageCompletion.p = pagenum;
                pageCompletion.b = isComplete;
            });
        },
        setScroll: function(pos) {
          args.connection.transaction([["scrollPositions"]], function(scrollPositions) {
            scrollPositions[args.user] = pos;
            scrollPositions.s = args.session;
          });
        },
        startStroke: function(page, x, y) {
          if (ctrl.tool() === 0 || ctrl.tool() === 1 || ctrl.tool() === 2) {
            ctrl.currentPage = page;

            args.connection.transaction([["pages"]], function(pages) {
              ctrl.curId = pages._id || 0;
              args.connection.transaction([["pages", page, "paths", "+"]], function(path) {
                var currentPath = ctrl.currentPath = this.props[0].slice(-1)[0];
                var opacity = ctrl.tool() === 1 ? 0.5 : 1;
                path[0] = {eraser: ctrl.tool() === 2, opacity: opacity, color: colors[ctrl.color[ctrl.tool()]], size: ctrl.size(), currentlyDrawing: true};
                path[1] = {x: x, y: y};
                args.connection.transaction([["undoStack", args.user]], function(undoStack) {
                  var undoStackHeight = array.length(undoStack);
                  if (undoStackHeight > 25) {
                    array.splice(undoStack, undoStack.height - 25);
                  }

                  array.push(undoStack, {action: "add-path", page: page, path: currentPath});
                });
              });
              return false;
            });
          }
        },
        addPoint: function(x, y) {
          if (ctrl.tool() === 0 || ctrl.tool() === 1 || ctrl.tool() === 2) {
            if (ctrl.currentPath === null) return;

            if (dist(x, y, ctrl.lastX, ctrl.lastY) < 5)
              return;

            ctrl.lastX = x;
            ctrl.lastY = y;

            args.connection.transaction([["pages"]], function(pages) {
              console.log(pages._id, ctrl.curId);
              if ((pages._id || 0) !== ctrl.curId)
                return false;

              args.connection.transaction([["pages", ctrl.currentPage, "paths", ctrl.currentPath]], function(path) {
                if (!path[0])
                  return false;

                var i = args.connection.array.push(path, {x: parseInt(x), y: parseInt(y), u: args.user, s: args.session}) - 1;

                var toReturn = this.props[0].slice();
                toReturn.push(i);
                return [toReturn];
              });

              return false;
            });
          }
        },
        endStroke: function() {
          if (ctrl.tool() === 0 || ctrl.tool() === 1 || ctrl.tool() === 2) {
            if (ctrl.currentPath === null) return;

            args.connection.transaction([["pages", ctrl.currentPage, "paths", ctrl.currentPath]], function(path) {
              if (!path[0])
                return false;

              path[0].currentlyDrawing = false;
              var toReturn = this.props[0].slice();
              toReturn.push(0);
              return [toReturn];
            });
          }

          ctrl.currentPath = null;
          ctrl.currentPage = null;
        },
        clear: function() {
          args.connection.transaction([["pages"]], function(pages) {
            var savedPages = {};
            array.forEach(pages, function(__, i) {
              savedPages[i] = pages[i];
              pages[i] = {paths: {}};
            });
            args.connection.transaction([["undoStack"]], function(undoStack) {
              for (var p in undoStack) {
                if (!isNaN(parseInt(p))) {
                  undoStack[p] = {};
                }
              }
            });
          });
        },
        undo: function() {
          args.connection.transaction([["undoStack", args.user]], function(undoStack) {
            var toUndo = array.pop(undoStack);

            if (typeof toUndo === "undefined")
              return;

            switch (toUndo.action) {
              case "add-path":
                args.connection.transaction([["pages", toUndo.page, "paths", toUndo.path]], function(path) {
                  path[0].hidden = true;
                });
              break;
            }
          });
        }
      };

      args.connection.userList.addObserver(function(users) {
        ctrl.userList(users);
        m.redraw(true);
      });

      PDFJS.getDocument(args.pdf).then(function(pdf) {
        ctrl.numPages(pdf.numPages);
        ctrl.pdf(pdf);
        m.redraw(true);
      });

      return ctrl;
    },
    view: function(ctrl, args) {
      var listener = function(e) {
      };
      return m("#main", {
          class: "scroll-" + ctrl.scroll(),
          config: function(el) {
            ctrl.fireScrollEvent = false;
            el.scrollTop = parseInt(ctrl.scrollPositions()[args.user] * (el.scrollHeight - window.innerHeight));
          },
          onscroll: function(e) {
            var el = e.target;
            if (!ctrl.fireScrollEvent) {
              ctrl.fireScrollEvent = true;
              m.redraw.strategy("none");
              return false;
            }
            ctrl.setScroll(el.scrollTop / (el.scrollHeight - window.innerHeight));
          }
        },
        m.component(PDFViewer, ctrl),
        m.component(Minimap, ctrl),
        m.component(Controls, ctrl)
      );

    }
  };

  var Controls = {
    view: function(__, args) {
      return m("#controls",
        m("span.glyphicon#minimap-chevron", {
          class: args.scroll() === "open" ? "glyphicon-chevron-right" : "glyphicon-chevron-left",
          onclick: function() {
            args.scroll(args.scroll() === "open" ? "closed" : "open");
          },
          ontouchend: function() {
            args.scroll(args.scroll() === "open" ? "closed" : "open");
          }
        }),
        m("span.glyphicon.glyphicon-remove#clear-screen", {
          onmousedown: args.clear,
          ontouchend: args.clear
        }),
        m("span.glyphicon.glyphicon-hand-left#undo", {
          onmousedown: args.undo
          //ontouchend: args.undo
        }),
        m("#tools",
          m.component(Tool, {tool: args.tool, color: args.color, toolId: 0, hasTray: true}),
          m.component(Tool, {tool: args.tool, color: args.color, toolId: 1, hasTray: true}),
          m.component(Tool, {tool: args.tool, color: {2: 4}, toolId: 2, hasTray: false}),
          m.component(SizeSelect, {size: args.size, color: args.color, tool: args.tool})
        )
      );
    }
  };

  var SizeSelect = {
    controller: function() {
      return {
        open: m.prop(false)
      };
    },
    view: function(ctrl, args) {
      return m("div.tool-button", {
          config: function(el, isInit) {
            if (!isInit) {
              document.addEventListener("mousedown", ctrl.open.bind(null, false));
              document.addEventListener("touchstart", ctrl.open.bind(null, false));
            }
          }
        },
        m("div.color-swatch-holder", {
          onmousedown: function(e) {
            ctrl.open(!ctrl.open());
          },
          ontouchend: function() {
            ctrl.open(!ctrl.open());
          }
        },
          m("div.pen-size", {
            style: "background-color: " + (colors[args.color[args.tool()]] || "black") + "; width: " + args.size() + "px; height:" + args.size() + "px; margin-top: " + (36 - args.size())/2 + "px; margin-left: " + (36 - args.size())/2 + "px;"
          })
        ),
        m("div#pen-tray", {
          class: ctrl.open() ? "tray-open" : "tray-closed"
        },
          [4, 8, 16, 24, 32].map(function(size) {
            var handler = function() {
              args.size(size);
              ctrl.open(false);
            };

            return m("div.color-swatch-holder", {
                onmousedown: handler,
                ontouchend: handler
              },
              m(".pen-size", {
                style: "background-color: " + (colors[args.color[args.tool()]] || "black") + "; width: " + size + "px; height:" + size + "px; margin-top: " + (36 - size)/2 + "px; margin-left: " + (36 - size)/2 + "px;",
              })
            );
          })
        )
      );
    }
  };

  var Tool = {
    controller: function() {
      return {
        open: m.prop(false)
      };
    },
    view: function(ctrl, args) {
      return m("div.tool-button", {
        config: function(el, isInit) {
            if (!isInit) {
              document.addEventListener("mousedown", ctrl.open.bind(null, false));
              document.addEventListener("touchstart", ctrl.open.bind(null, false));
            }
          }
        },
        m("div.color-swatch-holder", {
          class: (args.tool() === args.toolId ? "selected" : "")
        },
          m("div.color-swatch", {
            style: "background-color: " + colors[args.color[args.toolId]],
            onmousedown: function(e) {
              if (args.tool() !== args.toolId)
                args.tool(args.toolId);
              else
                ctrl.open(!ctrl.open());
            },
            ontouchend: function() {
              if (args.tool() !== args.toolId)
                args.tool(args.toolId);
              else
                ctrl.open(!ctrl.open());
            }
          })
        ),
        m("div#pen-tray", {
          class: ctrl.open() && args.hasTray ? "tray-open" : "tray-closed"
        },
          Object.keys(colors).map(function(colorId) {
            var handler = function() {
              args.color[args.toolId] = colorId;
              ctrl.open(false);
            };

            if (colorId == 4)
              return "";

            return m("div.color-swatch", {
              onmousedown: handler,
              ontouchend: handler,
              style: "background-color: " + colors[colorId] + "; " + (args.color[args.toolId] == colorId ? "display: none; " : ""),
            });
          })
        )
      );
    }
  };

  var PDFViewer = {
    controller: function(args) {
      return {
        interactable: null
      };
    },
    view: function(ctrl, args) {
      return m("#pdf-container", drawPDF(ctrl, args, 1));
    }
  };

  var Minimap = {
    controller: function(args) {
      return {

      };
    },
    view: function(ctrl, args) {
      return m("#minimap",
        args.userList().map(function(user) {
          return m.component(MinimapScreen, {
            scrollPositions: args.scrollPositions,
            setScroll: args.setScroll,
            user: user,
            userList: args.userList,
            pointerEvents: args.user === user.id
          });
        }),
        m("#minimap-overlay", " "),
        drawPDF(ctrl, args, 1)
      );
    }
  };

  var MinimapScreen = {
    controller: function(args) {
      return {
        interactable: null
      };
    },
    view: function(ctrl, args) {
      return m(".minimap-screen", {
        style: "height: " + (window.innerHeight / 10) + "px; ",
        class: (!args.pointerEvents ? "no-events" : ""),
        config: function(el, isInit, ctx) {
          var scrollPosition = args.scrollPositions()[args.user.id];

          var minimapRect = el.parentNode.getBoundingClientRect();
          var screenRect = el.getBoundingClientRect();

          var percentage = scrollPosition;
          var totalLength = minimapRect.height - screenRect.height;
          var currentPos = percentage * totalLength;

          el.style.transform = "translate(0px, " + currentPos + "px)";

          if (isInit)
            return;

          ctrl.interactable = interact(el).draggable({
            onmove: function(e) {
              var scrollPosition = args.scrollPositions()[args.user.id];

              var minimapRect = document.getElementById("minimap").getBoundingClientRect();
              var screenRect = el.getBoundingClientRect();

              var percentage = scrollPosition;
              var totalLength = minimapRect.height - screenRect.height;
              var currentPos = percentage * totalLength;

              var newY = currentPos + e.dy;
              var newPercentage = newY / totalLength;

              if (newPercentage >= 0 && newPercentage <= 1)
                args.setScroll(newPercentage);
            }
          });

          ctx.onunload = function() {
            if (ctrl.interactable)
              ctrl.interactable.unset();
          };
        }
      }, m(".minimap-background", {
        style: "background-color: " + userColors.getColor(args.userList(), args.user.id) + "; "

      }));
    }
  };

  function drawPDF(ctrl, args, scale) {
    return Array.apply(null, {length: args.numPages()}).map(function(__, i) {
      return m.component(PDFPageHolder, {
          size: args.size, 
          drawn: args.drawn, 
          startStroke: args.startStroke, 
          addPoint: args.addPoint, 
          endStroke: args.endStroke, 
          page: args.remotePages()[i], 
          currentPath: args.currentPath, 
          pdf: args.pdf(), 
          pageNum: i, 
          markPageComplete: function(isComplete) {
            args.markPageComplete(i, isComplete);
          }
      });
    });
  }

  var uniqueCode = 0;
  var PDFPageHolder = {
    controller: function(args) {
      var ctrl = {
        virtualWidth: 1000,
        virtualHeight: 1000 * 11 / 8.5,
        redrawing: false,
        target: null,
        localPenDown: false,
        uniqueId: uniqueCode++, 
        complete: false
      };

      ctrl.toggleComplete = function() {
        ctrl.complete = !ctrl.complete;
        args.markPageComplete(ctrl.complete);
      };

      return ctrl;
    },
    view: function(ctrl, args) {
      if(args.page)
      {
        // what is this??
        var bins = [[]];
        var curBin = 0;
        var eraser = false;

        var i = 0;
        var len = array.length(args.page.paths);
        if (len > 0) {
          while (args.page.paths[i] && args.page.paths[i][0] && args.page.paths[i][0].eraser)
            i++;
        }

        for (; i < len; i++) {
          var curPath = args.page.paths[i];

          if (!curPath || !curPath[0])
            continue;

          if (curPath[0].eraser !== eraser) {
            eraser = curPath[0].eraser;
            bins[++curBin] = [];
          }

          if (eraser)
            for (var j = 1; j < bins.length; j += 2) {
              bins[j].push(curPath);
            }
          else bins[curBin].push(curPath);
        }
      }

      //console.log(args);

      return m("div.pdf-page-holder",
        m("img.pdf-page", {
          onload: m.redraw,
          config: function(el, isInit) {
            if (isInit || ctrl.redrawing) {
                //drawPageCompletionMarker(ctrl.canvasctx, ctrl.complete);
                return;
            }

            var canvas = document.createElement("canvas");

            ctrl.redrawing = true;
            args.pdf.getPage(args.pageNum + 1).then(function(page) {
              var viewport = page.getViewport(1000 / page.getViewport(1).width * 1);
              canvas.height = viewport.height;
              canvas.width = viewport.width;
              ctrl.canvas = canvas;
              ctrl.canvasctx = canvas.getContext("2d");
              ctrl.imgel = el;

              page.render({canvasContext: ctrl.canvasctx, viewport: viewport}).then(function() {
                // TODO draw page completion here
                drawPageCompletionMarker(ctrl.canvasctx, ctrl.complete);
                el.src = canvas.toDataURL();
                ctrl.redrawing = false;
              });
            });
          }
        }),
        m("svg.drawing-surface", {
          "color-rendering": "optimizeSpeed",
          config: function(el) {
            var h = el.parentNode.children[0].getBoundingClientRect().height;
            el.style.marginTop = (-h) + "px";
            el.style.transform = "scale(" + (h / ctrl.virtualHeight) + ")";
            ctrl.target = el;
          },
          onmousedown: function(e) {
            var targetRect = ctrl.target.getBoundingClientRect();
            var localX = ctrl.localX = (e.pageX - targetRect.left);
            var localY = ctrl.localY = (e.pageY - targetRect.top);
            var x = localX / targetRect.width * ctrl.virtualWidth;
            var y = localY / targetRect.height * ctrl.virtualHeight;

            // Check to see if the student is clicking the page completion box
            if((x >= completionX) 
                && (x <= (completionX + completionW))
                && (y >= completionY)
                && (y <= (completionY + completionH))
            ) {
                // Mark/unmark and draw
                ctrl.toggleComplete();
                //requestAnimationFrame(drawPageCompletionMarker.bind(null, ctrl.canvasctx, ctrl.complete));
                drawPageCompletionMarker(args.pageNum, ctrl.complete);
                //e.src = ctrl.canvas.toDataURL();
                m.redraw();
                //console.log(ctrl.canvasctx);
            }

            console.log("down", x, y);
            requestAnimationFrame(args.startStroke.bind(null, args.pageNum, parseInt(x), parseInt(y)));
            ctrl.localPenDown = true;
            m.redraw.strategy("none");
          },
          onmousemove: function(e) {
            var targetRect = ctrl.target.getBoundingClientRect();
            var localX = ctrl.localX = (e.pageX - targetRect.left);
            var localY = ctrl.localY = (e.pageY - targetRect.top);
            var x = localX / targetRect.width * ctrl.virtualWidth;
            var y = localY / targetRect.height * ctrl.virtualHeight;
            //console.log("move", x, y);
            requestAnimationFrame(args.addPoint.bind(null, parseInt(x), parseInt(y)));
            m.redraw.strategy("none");
          },
          onmouseup: function(e) {
            var targetRect = ctrl.target.getBoundingClientRect();
            var x = (e.pageX - targetRect.left) / targetRect.width * ctrl.virtualWidth;
            var y = (e.pageY - targetRect.top) / targetRect.height * ctrl.virtualHeight;
            //console.log("up", x, y);
            requestAnimationFrame(args.endStroke);
            m.redraw.strategy("none");
            ctrl.localPenDown = false;
          },
          onmouseleave: function(e) {
            args.endStroke();
            m.redraw.strategy("none");
            ctrl.localPenDown = false;
          }
        },
        m("rect.completionbox", {id: "completionbox" + args.pageNum, x: 50, y: 50, width: 50, height: 50, stroke: 'black', "stroke-width": 5, fill: "transparent"}),
        args.page ?

        bins.map(function(bin, i) {
          return m((i % 2 === 0 ? "g" : "mask"),
          {
            mask: (i % 2 === 0 ? "url(#collection" + ctrl.uniqueId + "" + (i+1) + ")": ""),
            id: "collection" + ctrl.uniqueId + "" + i
          },
            (i % 2 == 1 ? (m("rect", {height: "100%", width: "100%", fill: "white"})) : ""),
            bin.map(function(path) {
              if (!path[0])
                return "";
              return m.component(Path, path);
            })
          );
        })
         : ""
        ),
        m(".eraser", {
          style: !ctrl.localPenDown ? "display: none;" : "",
          config: function(el) {
            var h = el.parentNode.children[0].getBoundingClientRect().height;
            el.style.marginTop = (-h) + "px";

            var size = args.size() * h / ctrl.virtualHeight;
            el.style.height = size + "px";
            el.style.width = size + "px";
            el.style.transform = "translate(" + (ctrl.localX - size / 2) + "px, " + (ctrl.localY - size / 2) + "px";
          }
        }, " ")
      );
    }
  };

  var Path = {
    controller: function() {
      return {
        drawn: false,
        lastErased: null,
        hidden: false
      };
    },
    view: function(ctrl, path) {
      if (ctrl.drawn && path[0].lastErased === ctrl.lastErased && path[0].hidden === ctrl.hidden)
        return {subtree: "retain"};
      else if (path[0].currentlyDrawing === false) {
        ctrl.drawn = true;
      }

      var xM = 1;
      var yM = 1;

      var dStr = "";

      if (!path[0].hidden) {
        var len = array.length(path);

        if (len < 3) {
          var tmp = [path[0], path[1], {x: path[1].x - 0.005, y: path[1].y}, path[1]];
          path = tmp;
          len = 4;
        }

        dStr += " M " + path[1].x * xM + " " + path[1].y * yM;

        for (var i = 2; i < len - 1; i++) {
          var xc = (path[i].x * xM + path[i + 1].x * xM) / 2;
          var yc = (path[i].y * yM + path[i + 1].y * yM) / 2;
          dStr += " Q " + (path[i].x * xM) + " " + (path[i].y * yM) + ", " + xc + " " + yc;
        }
      }

      ctrl.lastErased = path[0].lastErased;
      ctrl.hidden = path[0].hidden;

      return m("path", {
        "shape-rendering": (ctrl.drawn ? "auto" : "optimizeSpeed"),
        stroke: path[0].color || "black",
        "stroke-opacity": path[0].opacity,
        fill: "transparent",
        "stroke-width": path[0].size,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        d: dStr
      });
    }
  };
});
