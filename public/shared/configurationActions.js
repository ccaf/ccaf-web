define('configurationActions', ['exports', 'underscore'], function(exports, _) {
  exports.load = function(stm) {
    stm.action('init')
      .onReceive(function() {
        this.classrooms = this.classrooms || {};

        var classroom;
        for (c in this.classrooms) {
          classroom = this.classrooms[c];
          classroom.users = classroom.users || {};
          classroom.configuration = classroom.configuration || {};
          classroom.configuration.instances = classroom.configuration.instances || {};
          classroom.configuration.userInstanceMapping = classroom.configuration.userInstanceMapping || {};
        }
      });
      
    stm.action('create-app-instance')
      .onReceive(function(classroom, app, title, rval) {
        var instances = this.classrooms[classroom].configuration.instances;
        var id = 0;
        if (_.keys(instances).length > 0)
          id = Math.max.apply(null, _.keys(instances).map(function(val) { return val.toString() })) + 1;

        instances[id] = new Instance(app, title);
        
        if (typeof rval !== 'undefined')
          rval.instanceId = id;
      });
      
    stm.action('delete-app-instance')
      .onReceive(function(classroom, id) {
        var instances = this.classrooms[classroom].configuration.instances;
        instances[id] = null;
      });
      
    stm.action('associate-user-to-instance')
      .onReceive(function(classroom, userId, instanceId) {
        this.classrooms[classroom].configuration.userInstanceMapping[userId] = instanceId;
      });
  }
  
  
      
  function Instance(app, title, config) {
    this.app = app;
    this.title = title;
    this.root = {};
    this.config = config || {};
  }
});