import { supabase } from '../lib/supabase';

// Topic mapping for your existing JSON files
const TOPIC_MAPPING = {
  "artificial-intelligence-and-neural-networks.json": {
    name: "Artificial Intelligence and Neural Networks",
    short_name: "AI & NN",
    description: "Machine learning, neural networks, expert systems, and AI concepts"
  },
  "computer-organization-and-embedded-system.json": {
    name: "Computer Organization and Embedded Systems", 
    short_name: "COA & ES",
    description: "CPU architecture, memory systems, embedded systems design"
  },
  "concept-of-basic-electrical-and-electronics-engineering.json": {
    name: "Basic Electrical and Electronics Engineering",
    short_name: "EE Basics", 
    description: "Circuit analysis, electrical machines, electronics fundamentals"
  },
  "concept-of-computer-network-and-network-security-system.json": {
    name: "Computer Networks and Network Security",
    short_name: "Networks",
    description: "Network protocols, security, OSI model, TCP/IP"
  },
  "data-structures-and-algorithm-database-system-and-operating-system.json": {
    name: "Data Structures, Algorithms, Database & OS",
    short_name: "DSA & DB & OS", 
    description: "Data structures, algorithms, database systems, operating systems"
  },
  "digital-logic-and-microprocessor.json": {
    name: "Digital Logic and Microprocessor",
    short_name: "DL & µP",
    description: "Boolean algebra, logic gates, microprocessor architecture"
  },
  "programming-language-and-its-application.json": {
    name: "Programming Languages and Applications", 
    short_name: "Programming",
    description: "C programming, OOP concepts, programming fundamentals"
  },
  "project-planning-design-and-implementation.json": {
    name: "Project Planning, Design and Implementation",
    short_name: "Project Mgmt",
    description: "Project management, software development lifecycle"
  },
  "software-engineering-and-object-oriented-analysis-and-design.json": {
    name: "Software Engineering and OOAD",
    short_name: "SE & OOAD", 
    description: "Software engineering principles, UML, design patterns"
  },
  "theory-of-computation-and-computer-graphics.json": {
    name: "Theory of Computation and Computer Graphics",
    short_name: "TOC & CG",
    description: "Automata theory, formal languages, computer graphics"
  },
  "model-question.json": {
    name: "Model Questions",
    short_name: "Model",
    description: "Practice model questions for exam preparation"
  }
};

async function seedTopics() {
  console.log('📚 Seeding topics...');
  
  const topics = Object.values(TOPIC_MAPPING).map((topic, index) => ({
    name: topic.name,
    short_name: topic.short_name,
    description: topic.description,
    display_order: index + 1,
    total_questions: 0 // Will be updated after questions are seeded
  }));

  const { data, error } = await supabase
    .from('topics')
    .upsert(topics, { onConflict: 'name' })
    .select();

  if (error) {
    console.error('Error seeding topics:', error);
    throw error;
  }

  console.log(`✅ Seeded ${data.length} topics`);
  return data;
}

async function getTopicByName(name: string) {
  const { data, error } = await supabase
    .from('topics')
    .select('id')
    .eq('name', name)
    .single();

  if (error) throw error;
  return data.id;
}

async function seedQuestionsFromJSON() {
  console.log('📝 Seeding questions from JSON files...');
  
  let totalQuestions = 0;
  
  for (const [filename, topicInfo] of Object.entries(TOPIC_MAPPING)) {
    try {
      // Get topic ID
      const topicId = await getTopicByName(topicInfo.name);
      
      // Fetch the JSON file from your datasets folder
      const response = await fetch(`/datasets/extracted_questions/${filename}`);
      if (!response.ok) {
        console.warn(`⚠️  Could not load ${filename}`);
        continue;
      }
      
      const questionsData = await response.json();
      console.log(`  📄 Processing ${filename}: ${questionsData.length} questions`);
      
      // Prepare questions for insertion
      const questions = questionsData.map((q: any) => ({
        topic_id: topicId,
        question_text: q.qsns || '',
        option_1: q.opt1 || '',
        option_2: q.opt2 || '',  
        option_3: q.opt3 || '',
        option_4: q.opt4 || '',
        correct_option: q.correct_option || '',
        correct_option_index: q.correct_option_index || 0,
        explanation: q.explanation || null,
        difficulty: q.difficulty || 'medium'
      }));

      // Insert in batches of 100
      const batchSize = 100;
      for (let i = 0; i < questions.length; i += batchSize) {
        const batch = questions.slice(i, i + batchSize);
        
        const { error } = await supabase
          .from('questions')
          .insert(batch);
          
        if (error) {
          console.error(`Error inserting batch for ${filename}:`, error);
          // Continue with next batch instead of failing completely
        }
      }

      totalQuestions += questions.length;
      
      // Update topic question count
      await supabase
        .from('topics')  
        .update({ total_questions: questions.length })
        .eq('id', topicId);
        
    } catch (error) {
      console.error(`Error processing ${filename}:`, error);
    }
  }
  
  console.log(`✅ Seeded ${totalQuestions} questions total`);
}

export async function seedDatabase() {
  try {
    console.log('🌱 Starting database seeding...');
    
    await seedTopics();
    await seedQuestionsFromJSON();
    
    console.log('✅ Database seeding complete!');
    return true;
  } catch (error) {
    console.error('❌ Database seeding failed:', error);
    throw error;
  }
}

// For manual testing
if (import.meta.env.DEV) {
  (window as any).seedDatabase = seedDatabase;
}