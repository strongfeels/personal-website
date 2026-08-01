(function () {
  var floats = [];

  var QUOTES = [
    // tech / programming
    { text: "There are only two hard things in Computer Science: cache invalidation and naming things.", author: "Phil Karlton", font: "mono" },
    { text: "Debugging is twice as hard as writing the code in the first place.", author: "Brian Kernighan", font: "mono" },
    { text: "Premature optimization is the root of all evil.", author: "Donald Knuth", font: "mono" },
    { text: "Always code as if the guy maintaining your code will be a violent psychopath who knows where you live.", author: "John Woods", font: "mono" },
    { text: "Any fool can write code that a computer can understand. Good programmers write code that humans can understand.", author: "Martin Fowler", font: "mono" },
    { text: "Hofstadter's Law: It always takes longer than you expect, even when you take into account Hofstadter's Law.", author: "Douglas Hofstadter", font: "mono" },
    { text: "To iterate is human, to recurse divine.", author: "L. Peter Deutsch", font: "mono" },
    { text: "In order to understand recursion, you must first understand recursion.", author: null, font: "mono" },
    { text: "The best error message is the one that never shows up.", author: "Thomas Fuchs", font: "mono" },
    { text: "UNIX is user-friendly. It's just selective about who its friends are.", author: null, font: "mono" },
    { text: "Measuring programming progress by lines of code is like measuring aircraft building progress by weight.", author: "Bill Gates", font: "mono" },
    { text: "There's no place like 127.0.0.1", author: null, font: "mono" },
    { text: "undefined is not a function", author: "JavaScript", font: "mono" },
    { text: "works on my machine", author: "every developer, ever", font: "mono" },
    { text: "// TODO: fix this later", author: null, font: "mono" },
    { text: "The most disastrous thing you can ever learn is your first programming language.", author: "Alan Kay", font: "mono" },
    { text: "It's not a bug, it's an undocumented feature.", author: null, font: "mono" },
    { text: "git blame", author: null, font: "mono" },

    // philosophy
    { text: "The first principle is that you must not fool yourself — and you are the easiest person to fool.", author: "Richard Feynman", font: "serif" },
    { text: "The unexamined life is not worth living.", author: "Socrates", font: "serif" },
    { text: "Hell is other people.", author: "Jean-Paul Sartre", font: "serif" },
    { text: "Man is condemned to be free.", author: "Jean-Paul Sartre", font: "serif" },
    { text: "The trouble with the world is that the stupid are cocksure and the intelligent are full of doubt.", author: "Bertrand Russell", font: "serif" },
    { text: "The mass of men lead lives of quiet desperation.", author: "Henry David Thoreau", font: "serif" },
    { text: "We are all just walking each other home.", author: "Ram Dass", font: "serif" },
    { text: "Reality is merely an illusion, albeit a very persistent one.", author: "Albert Einstein", font: "serif" },
    { text: "The cave you fear to enter holds the treasure you seek.", author: "Joseph Campbell", font: "serif" },
    { text: "I am not what happened to me. I am what I choose to become.", author: "Carl Jung", font: "serif" },
    { text: "The universe is under no obligation to make sense to you.", author: "Neil deGrasse Tyson", font: "serif" },
    { text: "What we call the beginning is often the end. And to make an end is to make a beginning.", author: "T. S. Eliot", font: "serif" },
    { text: "Whoever fights monsters should see to it that in the process he does not become a monster.", author: "Nietzsche", font: "serif" },

    // wit
    { text: "Be yourself; everyone else is already taken.", author: "Oscar Wilde", font: "serif" },
    { text: "I can resist everything except temptation.", author: "Oscar Wilde", font: "serif" },
    { text: "Time flies like an arrow; fruit flies like a banana.", author: "Groucho Marx", font: "serif" },
    { text: "In theory, theory and practice are the same thing. In practice, they're not.", author: "Yogi Berra", font: "serif" },
    { text: "Outside of a dog, a book is man's best friend. Inside of a dog it's too dark to read.", author: "Groucho Marx", font: "serif" },
    { text: "I have not failed. I've just found 10,000 ways that won't work.", author: "Thomas Edison", font: "serif" },
    { text: "The cure for boredom is curiosity. There is no cure for curiosity.", author: "Dorothy Parker", font: "serif" },

    // science / observation
    { text: "The most exciting phrase in science is not 'Eureka!' but 'That's funny...'", author: "Isaac Asimov", font: "serif" },
    { text: "The good thing about science is that it's true whether or not you believe in it.", author: "Neil deGrasse Tyson", font: "serif" },
    { text: "If you thought that science was certain — well, that is just an error on your part.", author: "Richard Feynman", font: "serif" },
    { text: "Everything should be made as simple as possible, but not simpler.", author: "Albert Einstein", font: "serif" },

    // literature
    { text: "All animals are equal, but some animals are more equal than others.", author: "George Orwell", font: "serif" },
    { text: "The answer to the ultimate question of life, the universe, and everything is 42.", author: "Douglas Adams", font: "serif" },
    { text: "So it goes.", author: "Kurt Vonnegut", font: "serif" },
    { text: "Not all those who wander are lost.", author: "J.R.R. Tolkien", font: "serif" },
    { text: "All that we see or seem is but a dream within a dream.", author: "Edgar Allan Poe", font: "serif" },
    { text: "It was the best of times, it was the worst of times.", author: "Charles Dickens", font: "serif" },
    { text: "There is nothing either good or bad, but thinking makes it so.", author: "Shakespeare", font: "serif" },
    { text: "We accept the love we think we deserve.", author: "Stephen Chbosky", font: "serif" },
  ];

  function pick() {
    return QUOTES[Math.floor(Math.random() * QUOTES.length)];
  }

  function spawn() {
    var q = pick();

    var el = document.createElement('div');
    el.className = 'quote-float';

    var textEl = document.createElement('p');
    textEl.className = 'quote-text';
    textEl.textContent = '\u201c' + q.text + '\u201d';
    if (q.font === 'mono') textEl.classList.add('mono');
    el.appendChild(textEl);

    if (q.author) {
      var attrEl = document.createElement('span');
      attrEl.className = 'quote-attr';
      attrEl.textContent = '\u2014 ' + q.author;
      el.appendChild(attrEl);
    }

    // size based on text length
    var w, fs;
    if (q.text.length < 40)       { w = 200; fs = '1.25rem'; }
    else if (q.text.length < 80)  { w = 280; fs = '1rem'; }
    else if (q.text.length < 140) { w = 320; fs = '0.88rem'; }
    else                           { w = 360; fs = '0.78rem'; }

    el.style.width = w + 'px';
    textEl.style.fontSize = fs;

    // random card vs bare style
    if (Math.random() > 0.4) el.classList.add('card');

    var W = window.innerWidth;
    var H = window.innerHeight;

    var x, y;
    if (Math.random() < 0.3) {
      var edge = Math.floor(Math.random() * 4);
      if (edge === 0) { x = Math.random() * W; y = -120; }
      else if (edge === 1) { x = W + 20; y = Math.random() * H; }
      else if (edge === 2) { x = Math.random() * W; y = H + 20; }
      else { x = -w - 20; y = Math.random() * H; }
    } else {
      x = Math.random() * (W - w);
      y = Math.random() * (H - 120);
    }

    var speed = 0.2 + Math.random() * 0.6;
    var angle = Math.random() * Math.PI * 2;

    var f = {
      el: el,
      x: x, y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rot: (Math.random() - 0.5) * 18,
      rotV: (Math.random() - 0.5) * 0.08,
      w: w,
      opacity: 0,
      hovered: false,
      scale: 1,
    };

    el.style.opacity = '0';

    el.addEventListener('mouseenter', function () {
      f.hovered = true;
      el.style.zIndex = '20';
    });
    el.addEventListener('mouseleave', function () {
      f.hovered = false;
      el.style.zIndex = '';
    });

    document.body.appendChild(el);
    floats.push(f);

    while (floats.length > 25) {
      var old = floats.shift();
      (function (node) {
        node.style.transition = 'opacity .5s';
        node.style.opacity = '0';
        setTimeout(function () { node.remove(); }, 550);
      })(old.el);
    }
  }

  function startParty() {
    for (var i = 0; i < 14; i++) {
      (function (i) { setTimeout(spawn, i * 220); })(i);
    }
    setInterval(spawn, 2800);
  }

  function tick() {
    var W = window.innerWidth;
    var H = window.innerHeight;

    for (var i = 0; i < floats.length; i++) {
      var f = floats[i];

      if (f.opacity < 1) {
        f.opacity = Math.min(1, f.opacity + 0.02);
        f.el.style.opacity = f.opacity;
      }

      if (f.hovered) {
        var tx = W / 2 - f.w / 2;
        var ty = H / 2 - 60;
        f.x   += (tx - f.x)   * 0.1;
        f.y   += (ty - f.y)   * 0.1;
        f.rot += (0  - f.rot) * 0.12;
        f.scale += (1.08 - f.scale) * 0.1;
      } else {
        f.x += f.vx;
        f.y += f.vy;
        f.rot += f.rotV;
        f.scale += (1 - f.scale) * 0.1;

        if (f.x >  W + f.w)  f.x = -f.w;
        if (f.x < -f.w)      f.x =  W + f.w;
        if (f.y >  H + 200)  f.y = -200;
        if (f.y < -200)      f.y =  H + 200;
      }

      f.el.style.transform =
        'translate(' + f.x + 'px,' + f.y + 'px) rotate(' + f.rot + 'deg) scale(' + f.scale + ')';
    }

    requestAnimationFrame(tick);
  }

  startParty();
  requestAnimationFrame(tick);
})();
