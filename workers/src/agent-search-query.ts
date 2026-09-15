import {searchTermGroups} from './search';

type SearchScope = {query: string; date_from?: string; date_to?: string; category?: string; region?: string};

/** 2026-09-12 quota incident (738e3bb): scoring LIKE expressions did not
 * constrain the FTS index; count + top-N scanned the same corpus twice.
 * Preserve literal substring OR/alias semantics and the exact global rank.
 * Never drop short terms to force MATCH: trigram MATCH cannot find them.
 */
export function buildSearchQuery(scope: SearchScope, limit: number) {
  const groups=searchTermGroups(scope.query);
  if(!groups.length) throw new Error('INVALID_ARGUMENT: empty search query');
  const params: Array<string|number>=[], scoreParts: string[]=[];
  for(const group of groups) for(const [field,weight] of [['title',3],['title_en',3],['category',2],['summary',1]] as const) {
    const clauses=group.map(term=>{params.push(term);return `instr(a.${field},?)>0`;});
    scoreParts.push(`CASE WHEN (${clauses.join(' OR ')}) THEN ${weight} ELSE 0 END`);
  }
  const terms=[...new Set(groups.flat())];
  // A short alias is also an OR branch. Pruning by its long original loses hits.
  const indexed=terms.every(term=>[...term].length>=3 && !term.includes('\0'));
  const filters: string[]=[];
  if(indexed) {
    filters.push('a.id IN (SELECT rowid FROM agent_search_fts WHERE agent_search_fts MATCH ?)');
    params.push(terms.map(term=>'"'+term.replace(/"/g,'""')+'"').join(' OR '));
  }
  if(scope.date_from){filters.push('a.date >= ?');params.push(scope.date_from);}
  if(scope.date_to){filters.push('a.date <= ?');params.push(scope.date_to);}
  if(scope.category){filters.push('instr(a.category,?)>0');params.push(scope.category.toLowerCase());}
  if(scope.region){filters.push('instr(a.region,?)>0');params.push(scope.region.toLowerCase());}
  params.push(limit);
  if(params.length>100) throw new Error('INVALID_ARGUMENT: too many search terms or aliases');
  // Materialize once: totals and top-N consume the SAME scored result.
  // The LEFT JOIN preserves an explicit total=0 row for an empty match set.
  // Short queries still scan the filtered source table once; no FTS join.
  // This is not a hard quota bound: measure D1 meta before production approval.
  const sql=`WITH scored AS MATERIALIZED (
    SELECT a.uid,a.revision_id,a.date,(${scoreParts.join('+')}) AS score
    FROM agent_search_articles a ${filters.length?'WHERE '+filters.join(' AND '):''}
  ), matched AS MATERIALIZED (SELECT * FROM scored WHERE score>0),
  totals AS (SELECT COUNT(*) AS total FROM matched),
  top AS (SELECT * FROM matched ORDER BY score DESC,date DESC,uid ASC LIMIT ?)
  SELECT top.uid,top.revision_id,top.date,top.score,totals.total
  FROM totals LEFT JOIN top ON 1=1 ORDER BY top.score DESC,top.date DESC,top.uid ASC`;
  return {sql,params,mode:indexed?'fts_candidates':'short_term_scan'};
}
