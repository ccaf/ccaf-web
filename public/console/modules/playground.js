define(['exports', 'mithril', 'interact', 'underscore'], function(exports, m, interact, _) {    
  exports.view = function(ctrl, args) {
    return m('.container',
      m('.row',
        m('h1.col-md-12', 'ccaf-playground')
      ),
      m('.row', {
        'style': 'height: 80vh',
        },
        m.component(sidebar, args),
        m.component(overhead, args)
      )
    );
  };
  
  var sidebar = {
    'controller': function(args) {
      return {
        'tab': m.prop(0)
      };
    },
    'view': function(ctrl, args) {
      var tabs = [
        ["Apps", apps],
        ["Users", users],
        ["Content", content]
      ];
      
      return m('.col-xs-3.col-sm-3.col-md-3.stretch',
        m('ul.nav.nav-tabs',
          tabs.map(function(tab, i) { return m(ctrl.tab() == i ? 'li.active' : 'li', {'onclick': ctrl.tab.bind(this, i)},  m('a', tab[0])); })
        ),
        m('.tab-content.stretch',
          m('.tab-pane.active.stretch',
            m('.panel.panel-default.stretch.menu',
              tabs.filter(function(tab, i) { return ctrl.tab() === i; }).map(function(tab) { return m.component(tab[1], args); })
            )
          )
        )
      );
    }
  };
  
  
  var overhead = {
    'view': function(ctrl, args) {
      var store = args.store;
      return m('.col-xs-9.col-sm-9.col-md-9.stretch',
        m('.well.stretch#overhead', 
          _.pairs(args.configuration.instances)
            .map(function(pair) {
              return m.component(instance, _.extend(_.clone(args), {'id': pair[0], 'instance': pair[1]}));              
            })
        )
      );
    }
  };
  
  var apps = {
    'controller': function(args) {
      var store = args.store;
      interact('.createIcon')
        .draggable({
          'onstart': function(event) {
            var el = document.createElement('div');
            var rect = document.getElementById('overhead').getBoundingClientRect();
            el.setAttribute('data-x', event.pageX - 64 - rect.left);
            el.setAttribute('data-y', event.pageY - 64 - rect.top);
            
            if (event.target.getAttribute('data-app-path'))
              m.render(el, m.component(createIcon, {'icon': '/apps/' + event.target.getAttribute('data-app-path') + '/' + store.apps[event.target.getAttribute('data-app-path')].icon}));
            
            el.classList.add('createdIcon');
            document.getElementById('overhead').appendChild(el);
            event.target.childComponent = el;
          },
          'onmove': function(event) {
            var target = event.target.childComponent;
            var x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx;
            var y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;

            target.style.transform =
              'translate(' + x + 'px, ' + y + 'px)';

            target.setAttribute('data-x', x);
            target.setAttribute('data-y', y);
          },
          'onend': function(event) {
            if (isInWell(event.target.childComponent))
              store.sendAction('create-instance', event.target.getAttribute('data-app-path'), event.target.childComponent);
            
            event.target.childComponent.parentNode.removeChild(event.target.childComponent);
            event.target.childComponent = null;
          }
        });
    },
    'view': function(ctrl, args) {
      var store = args.store;
      return m('div.list-group', Object.keys(store.apps).map(function(app) {
          return m('a.list-group-item.createIcon', {
            'data-app-path': app
          }, m('img', {height: '32px', src: '/apps/' + app + '/' + store.apps[app].icon}), ' ' + store.apps[app].title);
        })
      );
    }
  };
  
  var createIcon = {
    'view': function(_, args) {
      return m('img', {'style': 'width: 64px; display: block; margin: 0 auto;', 'src': args.icon});
    }
  };
  
  var movableIcon = {
    'controller': function(args) {
      var store = args.store;
      interact('.movableIcon')
        .draggable({
          'onmove': function(event) {
            var target = event.target;
            var x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx;
            var y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;
            
            target.setAttribute('data-x', x);
            target.setAttribute('data-y', y);
            
            target.style.opacity = isInWell(target) ? 1 : 0.5;
            
            target.move(target);
          },
          'onend': function(event) {
            var target = event.target;
            target.style.opacity = 1;
            if (!isInWell(target))
              event.target.del();
          }
        });
    },
    'view': function(ctrl, args) {
      return m('div.movableIcon', {
        'config': function(el) {
            var overhead = document.getElementById('overhead');
            var x = args.x * overhead.offsetWidth;
            var y = args.y * overhead.offsetHeight;
            el.setAttribute('data-x', x);
            el.setAttribute('data-y', y);
            el.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
            el.move = function(el) { args.move(el) };
            el.del = args.del;
          },
       }, m('img', {'src': args.icon, 'style': 'display: block; margin: 0 auto;'}), args.title
      );
    }
  };
  
  var instance = {
    'view': function(ctrl, args) {
      var store = args.store;
      return m('span.instance', m.component(movableIcon, _.extend(_.clone(args), {
        'icon': '/apps/' + args.instance.app + '/' + store.apps[args.instance.app].icon,
        'title': args.instance.title,
        'x': args.instance.x,
        'y': args.instance.y,
        'move': function(el) {
          args.instance.sendAction('set-coords', el);
        },
        'del': function() {
          args.configuration.instances.sendAction('delete-instance', args.id);
        }
      })));
    }
  };
  
  var users = {
    'view': function(ctrl, args) {
      return m('div', 'users');
    }
  };
  
  var content = {
    'view': function(ctrl, args) {
      return m('div', 'content');
    }
  };
  
  function isInWell(el) {
    var overhead = document.getElementById('overhead');
    if (!overhead)
      return;
      
    var outerRect = overhead.getBoundingClientRect();
    var innerRect = el.getBoundingClientRect();
    
    return innerRect.top >= outerRect.top && innerRect.bottom <= outerRect.bottom && innerRect.left >= outerRect.left && innerRect.right <= outerRect.right;
  };
});