(function(f) {

  'use strict';

  function withoutTypeChecking(S) {
    return f (S.create ({checkTypes: false, env: S.env}));
  }

  /* istanbul ignore else */
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = withoutTypeChecking (require ('sanctuary'));
  } else if (typeof define === 'function' && define.amd != null) {
    define (['sanctuary'], withoutTypeChecking);
  } else {
    self.sanctuarySearch = withoutTypeChecking (self.sanctuary);
  }

} (function(S) {

  'use strict';

  //  S_pair :: (a -> b -> c) -> Pair a b -> c
  //
  //  To be added in sanctuary-js/sanctuary#609.
  var S_pair = S.curry2 (function(f, pair) {
    return f (pair.fst) (pair.snd);
  });

  //  tokens :: StrMap Boolean
  var tokens = {
    '::': true,
    '=>': true,
    '~>': true,
    '->': true,
    '()': true,
    '{}': true,
    '(': true,
    ')': true,
    '{': true,
    '}': true,
    ',': false,
    '?': false
  };

  //  syntax :: RegExp
  var syntax = S.pipe ([
    Object.keys,
    S.map (S.regexEscape),
    S.joinWith ('|'),
    S.concat ('('),
    S.flip (S.concat) (')'),
    S.regex ('')
  ]) (tokens);

  //  parseSignature :: String -> Maybe (Array (Pair Integer String))
  function parseSignature(signature) {
    var tokens = S.chain (S.splitOn (' ')) (signature.split (syntax));
    var context = [];
    var depth = 0;
    var result = [];
    for (var idx = 0; idx < tokens.length; idx += 1) {
      var token = tokens[idx];
      if (token === '(') {
        context.push (token);
        depth += 1;
      } else if (token === ')') {
        if (context.pop () !== '(') return S.Nothing;
        depth -= 1;
      } else if (token === '{') {
        context.push (token);
        result.push (S.Pair (depth) (token));
      } else if (token === '}') {
        if (context.pop () !== '{') return S.Nothing;
        result.push (S.Pair (depth) (token));
      } else if (token !== '') {
        result.push (S.Pair (depth) (token));
      }
    }
    if (context.length > 0) return S.Nothing;
    return S.Just (result);
  }

  //  repeat :: String -> Integer -> String
  var repeat = S.curry2 (function(s, n) {
    var result = '';
    while (result.length < n) result += s;
    return result;
  });

  //  format :: Array (Pair Integer String) -> String
  function format(pairs) {
    var s = '';
    var depth = 0;
    for (var idx = 0; idx < pairs.length; idx += 1) {
      var pair = pairs[idx];
      var isToken = Object.prototype.hasOwnProperty.call (tokens, pair.snd);
      s += repeat (')') (depth - pair.fst) +
           (isToken && !tokens[pair.snd] ? '' : s && ' ') +
           repeat ('(') (pair.fst - depth) +
           pair.snd;
      depth = pair.fst;
    }
    return s + repeat (')') (depth);
  }

  //  at :: Integer -> Array a -> Maybe a
  var at = S.curry2 (function(idx, xs) {
    return idx >= 0 && idx < xs.length ? S.Just (xs[idx]) : S.Nothing;
  });

  //  combine :: Pair a b -> Pair c d -> Pair (Pair a c) (Pair b d)
  var combine = S.compose (S_pair (S.bimap))
                          (S.bimap (S.Pair) (S.Pair));

  //  sliceMatches
  //  :: Array (Pair (Pair Integer String) (Pair Integer String))
  //  -> Maybe (StrMap String)
  //  -> Maybe (StrMap String)
  var sliceMatches = S.curry4 (function(
    actualTokens,
    searchTokens,
    offset,
    typeVarMap
  ) {
    var a = at (offset - 1) (actualTokens);
    var b = at (offset) (actualTokens);
    var y = at (offset + searchTokens.length - 1) (actualTokens);
    var z = at (offset + searchTokens.length) (actualTokens);

    var slice = actualTokens.slice (offset, offset + searchTokens.length);
    if (slice.length < searchTokens.length) return S.Nothing;
    if (slice.length === 0) return S.Nothing;

    var delta = slice[0].fst - searchTokens[0].fst;
    if (delta < 0) return S.Nothing;

    //  A question mark should never be separated from the preceding
    //  token. If the preceding token is a type variable, substitution
    //  may occur.
    //
    //  - '?' gives 'toMaybe :: a? -> Maybe a' (no match)
    //  - 'x' gives 'toMaybe :: a? -> Maybe @[a]@'
    //  - 'x?' gives 'toMaybe :: @[a?]@ -> Maybe a'
    var isQuestionMark = S.maybe (false) (S.compose (S.equals ('?')) (S.snd));
    if (isQuestionMark (b)) return S.Nothing;
    if (isQuestionMark (z)) return S.Nothing;

    //  isAlpha
    //  :: Maybe (Pair (Pair Integer Integer) (Pair String String)) -> Boolean
    var isAlpha = S.maybe (false)
                          (S.compose (S_pair (S.and))
                                     (S.bimap (S_pair (S.gte))
                                              (S.compose (S.test (/^[A-Za-z]/))
                                                         (S.snd))));
    if (isAlpha (S.lift2 (combine) (b) (a))) return S.Nothing;
    if (isAlpha (S.lift2 (combine) (y) (z))) return S.Nothing;

    if (S.gt (S.Just (0)) (S.map (S.fst) (S.head (searchTokens)))) {
      var depthContinues = S.on (S.equals) (S.map (S.fst));
      if (depthContinues (b) (a)) return S.Nothing;
      if (depthContinues (y) (z)) return S.Nothing;
    }

    return S.reduce
      (S.flip (function(pair) {
         return S.chain (function(state) {
           var typeVarMap = state.fst;
           return (
             pair.fst.fst === pair.snd.fst - delta ?
               /^[a-z]$/.test (pair.fst.snd) ?
                 /^[a-z]$/.test (pair.snd.snd) ?
                   pair.fst.snd in typeVarMap ?
                     typeVarMap[pair.fst.snd] === pair.snd.snd ?
                       S.Just (state) :
                       S.Nothing :
                     S.elem (pair.snd.snd) (typeVarMap) ?
                       S.Nothing :
                       S.Just (S.mapLeft (S.insert (pair.fst.snd)
                                                   (pair.snd.snd))
                                         (state)) :
                   S.Nothing :
                 pair.fst.snd === pair.snd.snd ?
                   S.Just (state) :
                   S.Nothing :
               S.Nothing
           );
         });
       }))
      (S.Just (S.Pair (typeVarMap) (S.Pair (searchTokens) (slice))))
      (S.zip (searchTokens) (slice));
  });

  //  highlightSubstring :: (String -> String) -> String -> String -> String
  var highlightSubstring = S.curry3 (function(em, s, t) {
    return S.map (function(i) {
                    var j = i + t.length;
                    return s.slice (0, i) + em (s.slice (i, j)) + s.slice (j);
                  })
                 (S.filter (S.gte (0))
                           (S.Just ((S.toLower (s)).indexOf (S.toLower (t)))));
  });

  //  matchTokens
  //  :: (String -> String)
  //  -> Array (Pair NonNegativeInteger String)
  //  -> Array (Pair NonNegativeInteger String)
  //  -> Either String String
  var matchTokens = S.curry3 (function(em, searchTokens, actualTokens) {
    function loop(typeVarMap, matched, offset, matches) {
      if (offset === actualTokens.length) return S.Pair (matched) (matches);

      return S.maybe_
        (function() {
           return loop (
             typeVarMap,
             matched,
             offset + 1,
             S.append (actualTokens[offset])
                      (matches)
           );
         })
        (function(pair) {
           var searchTokens = pair.snd.fst;
           var slice = pair.snd.snd;
           var depth = slice[0].fst - searchTokens[0].fst;
           return loop (
             pair.fst,
             true,
             offset + searchTokens.length,
             S.append (S.Pair (depth)
                              (em (format (S.map (S.mapLeft (S.sub (depth)))
                                                 (slice)))))
                      (matches)
           );
         })
        (sliceMatches (actualTokens) (searchTokens) (offset) (typeVarMap));
    }

    var matches =
    S.maybe ([])
            (S.compose (S.of (Array)) (S.Pair (0)))
            (S.join (S.lift2 (S.on (highlightSubstring (em)) (S.snd))
                             (S.head (actualTokens))
                             (S.chain (S.head)
                                      (S.filter (S.compose (S.equals (1))
                                                           (S.size))
                                                (S.Just (searchTokens))))));

    return S_pair (S.tagBy)
                  (S.bimap (S.K)
                           (format)
                           (loop (Object.create (null),
                                  matches.length > 0,
                                  matches.length,
                                  matches)));
  });

  //  matchStrings
  //  :: (String -> String)
  //  -> String
  //  -> String
  //  -> Either String String
  var matchStrings = S.curry3 (function(em, searchString, signatureString) {
    return S.fromMaybe (S.Left (signatureString))
                       (S.lift2 (matchTokens (em))
                                (parseSignature (searchString))
                                (parseSignature (signatureString)));
  });

  return matchStrings;

}));
