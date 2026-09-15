// Real SQLite queries behind a D1-shaped adapter. Does NOT model D1 billing,
// Worker CPU limits, distributed cache propagation or Cloudflare availability.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

export function sqliteD1(rows,snapshot_id) {
  const connection=new DatabaseSync(':memory:');
  connection.exec(readFileSync('migrations/0004_agent_search.sql','utf8'));
  const insert=connection.prepare('INSERT INTO agent_search_articles(uid,revision_id,date,title,title_en,category,region,summary) VALUES(?,?,?,?,?,?,?,?)');
  connection.exec('BEGIN');
  try {
    for(const row of rows)insert.run(row.uid,row._lineage.revision_id,String(row.date??''),
      ...['title','title_en','category','region','summary'].map(k=>String(row[k]??'').toLowerCase()));
    connection.prepare('INSERT INTO agent_search_meta VALUES(1,?,?,?)').run(snapshot_id,rows.length,0);
    connection.exec('COMMIT');
  } catch(error) {connection.exec('ROLLBACK');connection.close();throw error;}
  let batchCalls=0;
  function statement(sql,params=[]) {
    return {sql,params,bind(...params){return statement(sql,params);},
      async first(){return connection.prepare(sql).get(...params)??null;}};
  }
  return {connection,prepare:statement,get batchCalls(){return batchCalls;},
    async batch(statements){
      batchCalls++;connection.exec('BEGIN');
      try {
        const result=statements.map(s=>({success:true,results:connection.prepare(s.sql).all(...s.params)}));
        connection.exec('COMMIT');return result;
      } catch(error){connection.exec('ROLLBACK');throw error;}
    },close(){connection.close();}};
}
