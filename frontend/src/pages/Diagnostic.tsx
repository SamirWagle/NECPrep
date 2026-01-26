import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function DiagnosticPage() {
  const [status, setStatus] = useState<string[]>([]);
  
  const addStatus = (msg: string) => {
    setStatus(prev => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  useEffect(() => {
    async function runDiagnostics() {
      addStatus('🔍 Starting diagnostics...');
      
      // Test 1: Auth
      try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error) {
          addStatus(`❌ Auth error: ${error.message}`);
        } else if (user) {
          addStatus(`✅ Auth: Logged in as ${user.email}`);
        } else {
          addStatus('⚠️ Auth: No user');
        }
      } catch (err) {
        addStatus(`❌ Auth exception: ${err}`);
      }

      // Test 2: Database connection
      try {
        addStatus('📡 Testing database connection...');
        const { data, error } = await supabase
          .from('topics')
          .select('id, short_name, question_count')
          .limit(1);
        
        if (error) {
          addStatus(`❌ Database error: ${error.message}`);
          addStatus(`   Code: ${error.code}, Details: ${error.details}`);
        } else {
          addStatus(`✅ Database: Connected (found ${data?.length || 0} topics)`);
          if (data && data.length > 0) {
            addStatus(`   Sample: ${data[0].id} - ${data[0].short_name}`);
          }
        }
      } catch (err) {
        addStatus(`❌ Database exception: ${err}`);
      }

      // Test 3: Fetch all topics
      try {
        addStatus('📊 Fetching all topics...');
        const { data, error } = await supabase
          .from('topics')
          .select('*')
          .order('display_order');
        
        if (error) {
          addStatus(`❌ Topics error: ${error.message}`);
        } else {
          addStatus(`✅ Topics: Found ${data?.length || 0} topics`);
          data?.forEach(t => {
            addStatus(`   - ${t.id}: ${t.short_name} (${t.question_count} questions)`);
          });
        }
      } catch (err) {
        addStatus(`❌ Topics exception: ${err}`);
      }

      addStatus('🏁 Diagnostics complete');
    }

    runDiagnostics();
  }, []);

  return (
    <div style={{
      padding: '2rem',
      maxWidth: '800px',
      margin: '0 auto',
      fontFamily: 'monospace',
      backgroundColor: '#1a1a1a',
      minHeight: '100vh',
      color: '#fff'
    }}>
      <h1 style={{ marginBottom: '2rem', color: '#6366f1' }}>System Diagnostics</h1>
      <div style={{
        backgroundColor: '#0a0a0a',
        padding: '1.5rem',
        borderRadius: '8px',
        border: '1px solid #333'
      }}>
        {status.map((msg, i) => (
          <div key={i} style={{
            padding: '0.5rem 0',
            borderBottom: i < status.length - 1 ? '1px solid #222' : 'none',
            fontSize: '0.9rem'
          }}>
            {msg}
          </div>
        ))}
        {status.length === 0 && (
          <div style={{ color: '#666' }}>Running tests...</div>
        )}
      </div>
    </div>
  );
}
