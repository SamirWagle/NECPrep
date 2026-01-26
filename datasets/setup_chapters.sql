-- Clear existing topics and create 10 chapters
DELETE FROM topics;

-- Insert 10 chapters (only Chapter 1 has questions)
INSERT INTO topics (id, name, short_name, description, icon, color, question_count, data_file, display_order) VALUES
('chapter-1', 'Chapter 1: Basic Electrical & Electronics', 'Electrical Eng.', 'Circuit analysis, semiconductors, and digital electronics. Practice with real exam questions.', 'Zap', '#f97316', 587, 'ch1.json', 1),
('chapter-2', 'Chapter 2: Digital Logic & Microprocessor', 'Digital Logic', 'Logic gates, Boolean algebra, and microprocessor architecture', 'Cpu', '#3b82f6', 0, 'ch2.json', 2),
('chapter-3', 'Chapter 3: Programming & Applications', 'Programming', 'Programming fundamentals, data structures, and algorithms', 'Code', '#8b5cf6', 0, 'ch3.json', 3),
('chapter-4', 'Chapter 4: Computer Networks & Security', 'Networks', 'Network protocols, security systems, and communication', 'Network', '#06b6d4', 0, 'ch4.json', 4),
('chapter-5', 'Chapter 5: Database & Operating Systems', 'DB & OS', 'Database management, OS concepts, and system design', 'Database', '#10b981', 0, 'ch5.json', 5),
('chapter-6', 'Chapter 6: Software Engineering & OOAD', 'Software Eng.', 'SDLC, UML diagrams, and object-oriented design patterns', 'Settings', '#6366f1', 0, 'ch6.json', 6),
('chapter-7', 'Chapter 7: Theory of Computation & Graphics', 'Theory & Graphics', 'Automata, formal languages, and computer graphics fundamentals', 'Brain', '#ec4899', 0, 'ch7.json', 7),
('chapter-8', 'Chapter 8: AI & Neural Networks', 'AI & ML', 'Machine learning, neural networks, and AI algorithms', 'Brain', '#f59e0b', 0, 'ch8.json', 8),
('chapter-9', 'Chapter 9: Computer Organization', 'Hardware', 'Computer architecture, memory systems, and assembly language', 'HardDrive', '#14b8a6', 0, 'ch9.json', 9),
('chapter-10', 'Chapter 10: Project Planning & Design', 'Project Mgmt.', 'Project lifecycle, design methodologies, and implementation', 'ClipboardList', '#84cc16', 0, 'ch10.json', 10);
