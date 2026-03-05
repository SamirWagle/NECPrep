import { Link } from 'react-router-dom';
import { bookChapters } from '../../services/localData';

const SYLLABUS = [
  {
    chapterNum: 1,
    code: 'AExE01',
    title: 'Concept of Basic Electrical and Electronics Engineering',
    topics: [
      { code: '1.1', title: 'Basic concept', desc: "Ohm's law, voltage, current, power, energy, conducting/insulating materials, series & parallel circuits, star-delta conversion, Kirchhoff's law, linear/non-linear, bilateral/unilateral, active/passive circuits." },
      { code: '1.2', title: 'Network theorems', desc: 'Superposition, Thevenin, Norton, maximum power transfer theorems. R-L, R-C, R-L-C circuits, resonance in AC series/parallel circuits, active and reactive power.' },
      { code: '1.3', title: 'Alternating current fundamentals', desc: 'Generation of alternating voltages and currents, equations and waveforms, average, peak and RMS values. Three-phase system.' },
      { code: '1.4', title: 'Semiconductor devices', desc: 'Semiconductor diode characteristics, BJT configuration and biasing, small/large signal model, MOSFET and CMOS working principles and applications.' },
      { code: '1.5', title: 'Signal generators', desc: 'Basic principles of oscillators: RC, LC and Crystal oscillator circuits, waveform generators.' },
      { code: '1.6', title: 'Amplifiers', desc: 'Class A, B, AB output stages, biasing, power BJTs, transformer-coupled push-pull stages, tuned amplifiers, op-amps.' },
    ],
  },
  {
    chapterNum: 2,
    code: 'AExE02',
    title: 'Digital Logic and Microprocessor',
    topics: [
      { code: '2.1', title: 'Digital logic', desc: 'Number systems, logic levels, logic gates, Boolean algebra, SOP, POS, truth table to Karnaugh map.' },
      { code: '2.2', title: 'Combinational and arithmetic circuits', desc: 'Multiplexers, demultiplexers, decoder, encoder, binary addition/subtraction, signed/unsigned binary operations.' },
      { code: '2.3', title: 'Sequential logic circuits', desc: 'RS, gated, edge-triggered, master-slave flip-flops; registers and shift registers; asynchronous and synchronous counters.' },
      { code: '2.4', title: 'Microprocessor', desc: 'Internal architecture and features of microprocessors, assembly language programming.' },
      { code: '2.5', title: 'Microprocessor system', desc: 'Memory hierarchy, I/O and memory interfacing, PPI, serial interface, synchronous/asynchronous transmission, DMA and DMA controllers.' },
      { code: '2.6', title: 'Interrupt operations', desc: 'Interrupts, interrupt service routine (ISR), and interrupt processing.' },
    ],
  },
  {
    chapterNum: 3,
    code: 'ACtE03',
    title: 'Programming Language and Its Applications',
    topics: [
      { code: '3.1', title: 'Introduction to C programming', desc: 'C tokens, operators, I/O functions, control statements, looping, user-defined and recursive functions, arrays, string manipulations.' },
      { code: '3.2', title: 'Pointers, structures and data files', desc: 'Pointer arithmetic, pointer and arrays, structures vs unions, passing structures/pointers to functions, file I/O, sequential and random access.' },
      { code: '3.3', title: 'C++ with objects and classes', desc: 'Namespaces, function overloading, inline functions, default arguments, classes, access specifiers, constructors, destructors, dynamic memory, this pointer, static members, friend functions.' },
      { code: '3.4', title: 'Object-oriented programming features', desc: 'Operator overloading, data conversion, inheritance types (single, multiple, multilevel, hybrid, multipath), constructor/destructor in single/multilevel inheritance.' },
      { code: '3.5', title: 'Virtual functions and file handling', desc: 'Virtual functions, dynamic binding, file operations, error handling, stream class hierarchy, formatted/unformatted I/O, manipulators.' },
      { code: '3.6', title: 'Generic programming and exception handling', desc: 'Function/class templates, STL (containers, algorithms, iterators), try/catch/throw, multiple exceptions, exception specifications.' },
    ],
  },
  {
    chapterNum: 4,
    code: 'ACtE04',
    title: 'Computer Organization and Embedded System',
    topics: [
      { code: '4.1', title: 'Control and central processing units', desc: 'Control memory, addressing sequencing, microinstruction format, CPU structure, ALU, instruction formats, addressing modes, RISC/CISC, pipelining.' },
      { code: '4.2', title: 'Computer arithmetic and memory system', desc: 'Arithmetic/logical operations, memory hierarchy, cache memory principles, cache design elements (size, mapping, replacement, write policy).' },
      { code: '4.3', title: 'I/O organization and multiprocessors', desc: 'Peripheral devices, I/O modules, DMA, multiprocessor characteristics, interconnection structure, inter-processor communication.' },
      { code: '4.4', title: 'Embedded system design', desc: 'Embedded systems overview, classification, custom single-purpose processor design, ASIP, development environment.' },
      { code: '4.5', title: 'Real-time OS and control systems', desc: 'OS basics, tasks/processes/threads, multitasking, task scheduling/synchronization, device drivers, open-loop/closed-loop control.' },
      { code: '4.6', title: 'HDL and IC technology', desc: 'VHDL overview, data representation, combinational/sequential logic design, pipelining using VHDL.' },
    ],
  },
  {
    chapterNum: 5,
    code: 'ACtE05',
    title: 'Concept of Computer Network and Network Security System',
    topics: [
      { code: '5.1', title: 'Introduction and physical layer', desc: 'Networking models, protocols and standards, OSI and TCP/IP models, networking devices, transmission media.' },
      { code: '5.2', title: 'Data link layer', desc: 'Error detection/correction, flow control, multiple access protocols, LAN addressing, ARP, Ethernet, IEEE 802.x standards, PPP, WAN protocols.' },
      { code: '5.3', title: 'Network layer', desc: 'IP addressing, subnetting, routing protocols (RIP, OSPF, BGP), routing algorithms, ARP/RARP/ICMP, IPv6 packet formats and transition.' },
      { code: '5.4', title: 'Transport layer', desc: 'Transport services and protocols, ports and sockets, connection establishment/release, flow control, congestion control algorithms.' },
      { code: '5.5', title: 'Application layer', desc: 'HTTP/HTTPS, FTP, email, DNS, P2P, socket programming, application servers, traffic analyzers (MRTG, PRTG, SNMP, Wireshark).' },
      { code: '5.6', title: 'Network security', desc: 'Security types and attacks, cryptography, RSA, digital signatures, PGP, SSL, IPsec, VPN, WEP, firewalls.' },
    ],
  },
  {
    chapterNum: 6,
    code: 'ACtE06',
    title: 'Theory of Computation and Computer Graphics',
    topics: [
      { code: '6.1', title: 'Finite automata', desc: 'Finite automata and FSM, DFA/NDFA equivalence, minimization, regular expressions, pumping lemma for regular languages.' },
      { code: '6.2', title: 'Context-free languages', desc: 'CFG, parse trees, ambiguous grammars, CNF, GNF, BNF, pushdown automata, pumping lemma for CFLs.' },
      { code: '6.3', title: 'Turing machines', desc: 'Turing machine notation, language recognition, multi-track/multi-tape TMs, non-determinism, Church-Turing thesis, computational complexity, reducibility.' },
      { code: '6.4', title: 'Introduction to computer graphics', desc: 'Graphics hardware (display technology, raster/vector displays, display processors), graphics software and standards.' },
      { code: '6.5', title: '2D transformations', desc: 'Translation, rotation, scaling, reflection, shear, composite transformations, 2D viewing pipeline, world-to-screen transformation, Cohen-Sutherland and Liang-Barsky clipping.' },
      { code: '6.6', title: '3D transformations', desc: 'Translation, rotation, scaling, reflection, shear, 3D composite transformations, 3D viewing pipeline, orthographic/parallel/perspective projections.' },
    ],
  },
  {
    chapterNum: 7,
    code: 'ACtE07',
    title: 'Data Structures and Algorithm, Database System and Operating System',
    topics: [
      { code: '7.1', title: 'Data structures, lists and trees', desc: 'Abstract data types, Big-O/Ω/Θ analysis, stacks, queues, linked lists (singly, doubly, circular), binary trees, AVL trees, tree traversals.' },
      { code: '7.2', title: 'Sorting, searching and graphs', desc: 'Insertion, selection, exchange, merge, radix, shell, heap sort; sequential/binary/tree search; hashing; directed/undirected graphs, BFS/DFS, topological sort, MST, shortest path (Dijkstra).' },
      { code: '7.3', title: 'Data models, normalization and SQL', desc: 'E-R model, normal forms (1NF–BCNF), functional dependencies, DDL/DML queries, views, relational algebra, query optimization.' },
      { code: '7.4', title: 'Transaction processing and concurrency', desc: 'ACID properties, serializability, lock-based protocols, deadlock handling, failure classification, log-based recovery.' },
      { code: '7.5', title: 'Operating system and process management', desc: 'OS types and structure, process states and control, threads, scheduling, concurrency, critical regions, semaphores, monitors, classical synchronization problems.' },
      { code: '7.6', title: 'Memory management and file systems', desc: 'Swapping, virtual memory, demand paging, page replacement algorithms, file systems, directory structures, system administration, user account management.' },
    ],
  },
  {
    chapterNum: 8,
    code: 'ACtE08',
    title: 'Software Engineering and Object-Oriented Analysis & Design',
    topics: [
      { code: '8.1', title: 'Software process and requirements', desc: 'Software quality, process models (Agile, V-Model, Iterative, Prototype, Big Bang), functional/non-functional requirements, SRS, requirements elicitation/validation.' },
      { code: '8.2', title: 'Software design', desc: 'Design concepts and heuristics, architectural decisions, modular decomposition, client-server architectures, real-time and component-based design.' },
      { code: '8.3', title: 'Testing, cost estimation and quality', desc: 'Unit/integration/system/acceptance testing, test case design, algorithmic cost modeling, SQA, CMMI, ISO standards, configuration management, CASE tools.' },
      { code: '8.4', title: 'OO analysis', desc: 'Defining models, use cases, OO development cycle, UML, conceptual models, associations, attributes, system behavior representation.' },
      { code: '8.5', title: 'OO design', desc: 'Analysis to design, use case elaboration, collaboration diagrams, determining visibility, class diagrams.' },
      { code: '8.6', title: 'OO design implementation', desc: 'Mapping design to code, creating class definitions, methods from collaboration diagrams, exception and error handling.' },
    ],
  },
  {
    chapterNum: 9,
    code: 'ACtE09',
    title: 'Artificial Intelligence and Neural Networks',
    topics: [
      { code: '9.1', title: 'Introduction to AI and intelligent agents', desc: 'AI concepts, history, applications, intelligent agent structure, PEAS description, agent types (reflexive, model-based, goal-based, utility-based), environment types.' },
      { code: '9.2', title: 'Problem solving and search', desc: 'State space search, uninformed search (DFS, BFS, DLS, IDS, bidirectional), informed search (greedy best-first, A*, hill climbing, simulated annealing), minimax, alpha-beta pruning.' },
      { code: '9.3', title: 'Knowledge representation', desc: 'Semantic nets, frames, propositional logic, predicate logic (FOPL), Bayes rule, Bayesian networks, reasoning in belief networks.' },
      { code: '9.4', title: 'Expert systems and NLP', desc: 'Expert system architecture, knowledge acquisition, NLP terminology, natural language understanding/generation, NLP steps and challenges, machine vision, robotics.' },
      { code: '9.5', title: 'Machine learning', desc: 'Supervised/unsupervised/reinforcement learning, decision trees, Naive Bayes, fuzzy learning, fuzzy inference systems, genetic algorithms.' },
      { code: '9.6', title: 'Neural networks', desc: 'Biological vs ANN, McCulloch-Pitts neuron, activation functions, perceptron, gradient descent, delta rule, Hebbian learning, Adaline, MLP, backpropagation, Hopfield networks.' },
    ],
  },
  {
    chapterNum: 10,
    code: 'AALL10',
    title: 'Project Planning, Design and Implementation',
    topics: [
      { code: '10.1', title: 'Engineering drawings', desc: 'Standard drawing sheets, dimensions, scale, orthographic/isometric projections, pictorial views, sectional drawing.' },
      { code: '10.2', title: 'Engineering economics', desc: 'Project cash flow, discount rate, time value of money, Discounted Payback Period, NPV, IRR, MARR, depreciation and taxation in Nepal.' },
      { code: '10.3', title: 'Project planning and scheduling', desc: 'Project life cycle, planning process, bar charts, CPM, PERT, resource levelling, monitoring and evaluation.' },
      { code: '10.4', title: 'Project management', desc: 'Information systems, risk analysis and management, project financing, tender process, contract management.' },
      { code: '10.5', title: 'Engineering professional practice', desc: 'Environment and society, professional ethics, regulatory environment, occupational health and safety, roles of Nepal Engineers Association (NEA).' },
      { code: '10.6', title: 'Engineering regulatory body', desc: 'Nepal Engineering Council (NEC) Acts and Regulations.' },
    ],
  },
];

// Map chapter number → bookChapter id (for practice button)
function getPracticeId(chapterNum: number): string | null {
  const ch = bookChapters.find(c => c.id === `book-ch${chapterNum}`);
  return ch ? ch.id : null;
}

export default function StudyHub() {

  return (
    <div className="study-hub-page">
      {/* Page header */}
      <header className="page-header">
        <h1>Study Materials</h1>
        <p>Access comprehensive study guides and materials for all topics</p>
      </header>

      {/* Study modes */}
      <section className="study-modes" aria-labelledby="modes-title">
        <h2 id="modes-title" className="sr-only">Study Options</h2>
        <div className="modes-grid">
          <Link to="/app/flashcards" className="mode-card mode-flashcard">
            <div className="mode-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="M10 4v4"/>
                <path d="M2 8h20"/>
                <path d="M6 4v4"/>
              </svg>
            </div>
            <div className="mode-content">
              <h3>Flashcards</h3>
              <p>Quick revision with interactive flashcards</p>
            </div>
          </Link>

          <Link to="/app/bookmarks" className="mode-card mode-bookmark">
            <div className="mode-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div className="mode-content">
              <h3>Bookmarks</h3>
              <p>Review your saved questions and notes</p>
            </div>
          </Link>

          <div className="mode-card mode-notes">
            <div className="mode-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </div>
            <div className="mode-content">
              <h3>My Notes</h3>
              <p>Access your personal study notes</p>
            </div>
            <span className="coming-soon-badge">Coming Soon</span>
          </div>
        </div>
      </section>

      {/* Topics grid */}
      <section className="study-topics" aria-labelledby="topics-title">
        <h2 id="topics-title">Study by Topic</h2>
        {loading ? (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Loading topics...</p>
          </div>
        ) : (
          <div className="topics-grid">
            {bookChapters.map((topic) => (
              <Link 
                to={`/app/study/topic/${topic.id}`}
                key={topic.id}
                className="topic-card"
              >
                <div className="topic-icon" style={{ backgroundColor: `${topic.color || '#6366f1'}15`, color: topic.color || '#6366f1' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                  </svg>
                </div>
                <div className="topic-content">
                  <h3>{topic.name}</h3>
                  <p>{topic.description}</p>
                  <div className="topic-meta">
                    <span className="chapter-count">{topic.questionCount} questions</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

