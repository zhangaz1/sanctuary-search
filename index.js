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

  //  parseSignature :: String -> Nullable (Array (Pair Integer String))
  function parseSignature(signature) {
    var tokens = S.chain (S.splitOn (' '))
                         (signature.split (/([(][)]|[{][}]|[({,})])/));
    var context = {
      value: [],
      depth: 0,
      push: function(c) {
        if (c === '(') this.depth += 1;
        this.value.push (c);
      },
      pop: function() {
        var c = this.value.pop ();
        if (c === '(') this.depth -= 1;
        return c;
      }
    };
    var result = [];
    for (var idx = 0; idx < tokens.length; idx += 1) {
      var token = tokens[idx];
      if (token === '(') {
        context.push (token);
      } else if (token === ')') {
        if (context.pop () !== '(') return null;
      } else if (token === '{') {
        context.push (token);
        result.push (S.Pair (context.depth) (token));
      } else if (token === '}') {
        if (context.pop () !== '{') return null;
        result.push (S.Pair (context.depth) (token));
      } else if (token !== '') {
        result.push (S.Pair (context.depth) (token));
      }
    }
    if (context.value.length > 0) return null;
    return result;
  }

  //  repeat :: (String, Integer) -> String
  function repeat(s, n) {
    var result = '';
    while (result.length < n) result += s;
    return result;
  }

  //  format :: Array (Pair Integer String) -> String
  function format(pairs) {
    var s = '';
    var depth = 0;
    for (var idx = 0; idx < pairs.length; idx += 1) {
      var pair = pairs[idx];
      s += repeat (')', depth - pair.fst) +
           (s === '' || pair.snd === ',' ? '' : ' ') +
           repeat ('(', pair.fst - depth) +
           pair.snd;
      depth = pair.fst;
    }
    return s + repeat (')', depth);
  }

  //  legalBoundary :: (Array (Pair Integer String), Integer) -> Boolean
  function legalBoundary(tokens, idx) {
    var l = tokens[idx - 1];
    var r = tokens[idx];
    return l == null || /^(?![A-Za-z])/.test (l.snd) ||
           r == null || /^(?![A-Za-z])/.test (r.snd) ||
           l.fst !== r.fst;
  }

  //  sliceMatches :: Array (Pair (Pair Integer String) (Pair Integer String)) -> Boolean
  function sliceMatches(pairs) {
    var delta = pairs[0].snd.fst - pairs[0].fst.fst;
    var typeVarMap = Object.create (null);

    return S.all (function(pair) {
      return pair.fst.fst === pair.snd.fst - delta
             && (/^[a-z]$/.test (pair.fst.snd) ?
                 /^[a-z]$/.test (pair.snd.snd)
                 && (pair.fst.snd in typeVarMap ?
                     typeVarMap[pair.fst.snd] === pair.snd.snd :
                     S.not (S.elem (pair.snd.snd) (typeVarMap))
                     && (typeVarMap = S.insert (pair.fst.snd)
                                               (pair.snd.snd)
                                               (typeVarMap),
                         true)) :
                 pair.fst.snd === pair.snd.snd);
    }) (pairs);
  }

  //  match :: (String -> String, String, String) -> Either String String
  function match(em, signatureString, searchString) {
    var actualTokens = parseSignature (signatureString);
    var searchTokens = parseSignature (searchString);
    if (actualTokens == null || searchTokens == null) {
      return S.Left (signatureString);
    }

    function loop(matched, offset, matches) {
      var depth, slice;
      return (
        offset === actualTokens.length ?
        S.Pair (matched) (matches) :
        offset + searchTokens.length <= actualTokens.length
        && legalBoundary (actualTokens, offset)
        && legalBoundary (actualTokens, offset + searchTokens.length)
        && sliceMatches (S.zip (searchTokens)
                               (slice = actualTokens.slice (
                                          offset,
                                          offset + searchTokens.length))) ?
        loop (true,
              offset + searchTokens.length,
              S.append (S.Pair (depth = S.min (slice[0].fst)
                                              (slice[slice.length - 1].fst))
                               (em (format (S.map (S.mapLeft (S.sub (depth)))
                                                  (slice)))))
                       (matches)) :
        loop (matched,
              offset + 1,
              S.append (actualTokens[offset])
                       (matches))
      );
    }

    var matches = (function() {
      //  Special case for matching by function name.
      if (searchTokens.length === 1) {
        var search = searchTokens[0].snd, searchLower = search.toLowerCase ();
        var actual = actualTokens[0].snd, actualLower = actual.toLowerCase ();
        if (searchLower !== actualLower) {
          var idx = actualLower.indexOf (searchLower);
          if (idx >= 0) {
            return [S.Pair (0)
                           (actual.slice (0, idx) +
                            em (actual.slice (idx, idx + search.length)) +
                            actual.slice (idx + search.length))];
          }
        }
      }
      return [];
    } ());

    var pair = loop (matches.length > 0, matches.length, matches);
    return S.tagBy (S.K (pair.fst)) (format (pair.snd));
  }

  return {
    match: S.curry3 (match)
  };

}));
