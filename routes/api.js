var router = require('express').Router();
var db = require('../middleware/db.js');
var encryption = require('../middleware/encryption.js');
var uuid = require('node-uuid');

module.exports= function(io){
  function gen_session(user, callback){
    var sid = uuid.v4();
    var session_block = {
      Key: sid,
      User: user,
      Expires: new Date().getTime() + 6*60*60*1000
    };
    db.query('Insert into Sessions(`Key`, `UserID`, `Expires`) Values(?, ?, ?);', [session_block.Key, session_block.User.ID, session_block.Expires], function(err, result){
      if(err){
        return callback(err);
      }
      return callback(null, session_block);
    });
  }

  /*
  * Public Methods
  */
  router.post('/signup', function(req, res){
    var username = req.body.Username;
    var email = req.body.Email;
    var pass = req.body.Password;
    var salt = uuid.v4();
    var encpass = encryption.hash(salt+"|"+pass);
    var confirm = uuid.v4();
    db.query('Insert into Users(`Username`, `Email`, `Password`, `Salt`, `Confirm`, `Active`) VALUES(?,?,?,?,?,1);', [username, email, encpass, salt, confirm], function(err, results){
      if(err){
        console.log(err);
        return res.send({Success: false, Error: err});
      }
      //send email;
      return res.send({Success: true, Message: "Confirmation email sent."});
    });
  });

  router.get('/verification/:v_key', function(req, res){
    db.query('Update Users set `Active`=1 where `Confirm`=?', [req.params.v_key], function(err, result){
      if(err){
        console.log(err);
        return res.send({Success: false, Error: err});
      }
      return res.render('email_confirmed');
    });
  });

  router.post('/login', function(req, res){
    var username = req.body.Username;
    var pass = req.body.Password;
    db.query('Select `Password`, `Salt`, `Role`, `ID`, `Username`, `Active` from Users where `Username` = ?', [username], function(err, results){
      if(err){
        console.log(err);
        return res.send({Success: false, Error: err});
      }
      if(results.length<1){
        return res.send({Success:false, Error:"No such username"});
      }
      var user = results[0];
      if(user.Active == 0){
        return res.send({Success:false, Error:"Account is not active"});
      }
      var validpass = (encryption.hash(user.Salt+"|"+pass) === user.Password);
      if(validpass){
        var public_user = {ID: user.ID, Username: user.Username, Role:user.Role};
        gen_session(public_user, function(err, session){
          if(err){
            console.log(err);
            return res.send({Success: false, Error: err});
          }
          delete user.Password;
          delete user.Salt;
          console.log(user);
          return res.send({Success: true, Data:{Session:session, User:user}});
        });
      }
      else{
          return res.send({Success: false, Error: 'Incorrect Password'});
      }
    });
  });

  router.get('/auth/:sessionID', function(req, res){
    var sid = req.params.sessionID;
    var keylookup = 'Select Users.`Username`, Users.`ID`, Users.`Role`, Sessions.`Key`, Sessions.`Expires` from Sessions join Users on Sessions.`UserID` = Users.`ID` Where Sessions.`Active`=1 AND Sessions.`Key`=?;';
    db.query(keylookup, [sid], function(err, results){
      if(err){
        console.log(err);
        return res.send({Success: false, Error: err});
      }
      if(results.length<1){
        return res.send({Success:false, Error:"Invlaid SessionID"});
      }
      var uinfo = results[0];
      return res.send({Success: true, Data:{Session:{Key:uinfo.Key, Expires:uinfo.Expires}, User:{Username: uinfo.Username, ID: uinfo.ID, Role: uinfo.Role}}});
    });
  });

  /*
  * Authentication gateway
  */

  router.use(function(req, res, next){
    var authZ = req.headers.Authorization || req.headers.authorization;
    if(!authZ){
      return res.send({Success:false, Error:"No valid Auth token"});
    }
    var keylookup = 'Select Users.`Username`, Users.`ID`, Users.`Role`, Sessions.`Key`, Sessions.`Expires` from Sessions join Users on Sessions.`UserID` = Users.`ID` Where Sessions.`Active`=1 AND Sessions.`Key`=?;';
    db.query(keylookup, [authZ], function(err, results){
      if(err){
        return res.send({Success: false, Error: err});
      }
      if(!results || results.length <1){
        return res.send({Success: false, Error: "Invalid Auth!"});
      }
      var user=results[0];
      res.locals.usersession = user;
      next();
    });
  });

  /*
  * External Methods
  */
  router.use('/radio/', require('./radio.js')(io));
  router.use('/playlists/', require('./playlists.js')(io));

  // start chat api
  require('./chat.js')(io);

  return router;
}
