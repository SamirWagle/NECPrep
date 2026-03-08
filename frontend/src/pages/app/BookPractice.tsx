import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getTopicProgress } from '../../services/localData';
import { useChapters } from '../../hooks/useChapters';

const SYLLABUS = [
  {
    num: 1, code: 'AExE01',
    title: 'Concept of Basic Electrical and Electronics Engineering',
    color: '#f59e0b',
    topics: [
      { code: '1.1', title: 'Basic Concept', desc: "Ohm's law, electric voltage, current, power and energy, conducting and insulating materials. Series and parallel electric circuits, star-delta and delta-star conversion, Kirchhoff's law, linear and non-linear circuit, bilateral and unilateral circuits, active and passive circuits." },
      { code: '1.2', title: 'Network Theorems', desc: "Superposition theorem, Thevenin's theorem, Norton's theorem, maximum power transfer theorem. R-L, R-C, R-L-C circuits, resonance in AC series and parallel circuit, active and reactive power." },
      { code: '1.3', title: 'Alternating Current Fundamentals', desc: "Principle of generation of alternating voltages and currents, equations and waveforms, average, peak and RMS values. Three-phase system." },
      { code: '1.4', title: 'Semiconductor Devices', desc: "Semiconductor diode characteristics, BJT configuration and biasing, small and large signal model, working principle and application of MOSFET and CMOS." },
      { code: '1.5', title: 'Signal Generators', desc: "Basic principles of oscillators: RC, LC and Crystal oscillator circuits, waveform generators." },
      { code: '1.6', title: 'Amplifiers', desc: "Class A, B, AB output stages, biasing, power BJTs, transformer-coupled push-pull stages, tuned amplifiers, op-amps." },
    ],
  },
  {
    num: 2, code: 'AExE02',
    title: 'Digital Logic and Microprocessor',
    color: '#6366f1',
    topics: [
      { code: '2.1', title: 'Digital Logic', desc: "Number systems, logic levels, logic gates, Boolean algebra, Sum-of-Products method, Product-of-Sums method, truth table to Karnaugh map." },
      { code: '2.2', title: 'Combinational and Arithmetic Circuits', desc: "Multiplexers, demultiplexers, decoder, encoder, binary addition/subtraction, unsigned and signed binary number operations." },
      { code: '2.3', title: 'Sequential Logic Circuits', desc: "RS, gated, edge-triggered, master-slave flip-flops. Types of registers, shift register applications, asynchronous and synchronous counters." },
      { code: '2.4', title: 'Microprocessor', desc: "Internal architecture and features of microprocessors, assembly language programming." },
      { code: '2.5', title: 'Microprocessor System', desc: "Memory device classification and hierarchy, I/O and memory parallel interface, PPI, serial interface, synchronous/asynchronous transmission, serial interface standards, DMA and DMA controllers." },
      { code: '2.6', title: 'Interrupt Operations', desc: "Interrupt, interrupt service routine (ISR), and interrupt processing." },
    ],
  },
  {
    num: 3, code: 'ACtE03',
    title: 'Programming Language and Its Applications',
    color: '#22c55e',
    topics: [
      { code: '3.1', title: 'Introduction to C Programming', desc: "C tokens, operators, formatted/unformatted I/O, control statements, looping, user-defined functions, recursive functions, arrays (1-D, 2-D, multi-dimensional), string manipulations." },
      { code: '3.2', title: 'Pointers, Structure and Data Files in C', desc: "Pointer arithmetic, pointer and arrays, passing pointers to functions. Structure vs union, array of structures, passing structure to function, structure and pointer. I/O operations on files, sequential and random access." },
      { code: '3.3', title: 'C++ with Objects and Classes', desc: "Namespace, function overloading, inline functions, default arguments, pass/return by reference. Classes, access specifiers, member functions, constructors, destructors, dynamic memory, this pointer, static members, friend functions and classes." },
      { code: '3.4', title: 'Object-Oriented Programming Features', desc: "Operator overloading (unary, binary), data conversion, inheritance (single, multiple, multilevel, hybrid, multipath), constructor/destructor in single/multilevel inheritance." },
      { code: '3.5', title: 'Virtual Functions and File Handling', desc: "Virtual functions, dynamic binding, file operations (open/close), I/O operations on files, error handling, stream class hierarchy, formatted/unformatted I/O, manipulators." },
      { code: '3.6', title: 'Generic Programming and Exception Handling', desc: "Function templates, class templates, STL (containers, algorithms, iterators), try/catch/throw, multiple exception handling, rethrowing, catching all exceptions, exception specifications, uncaught/unexpected exceptions." },
    ],
  },
  {
    num: 4, code: 'ACtE04',
    title: 'Computer Organization and Embedded System',
    color: '#ec4899',
    topics: [
      { code: '4.1', title: 'Control and Central Processing Units', desc: "Control memory, addressing sequencing, computer configuration, microinstruction format, CPU structure and function, ALU, instruction formats, addressing modes, data transfer and manipulation, RISC/CISC, pipelining, parallel processing." },
      { code: '4.2', title: 'Computer Arithmetic and Memory System', desc: "Arithmetic and logical operations, memory hierarchy, internal and external memory, cache memory principles, cache design elements (size, mapping, replacement algorithm, write policy, number of caches), memory write-ability and storage permanence." },
      { code: '4.3', title: 'Input-Output Organization and Multiprocessor', desc: "Peripheral devices, I/O modules, input-output interface, modes of transfer, DMA, multiprocessor characteristics, interconnection structure, inter-processor communication and synchronization." },
      { code: '4.4', title: 'Embedded System Design', desc: "Embedded systems overview, classification, custom single-purpose processor design, optimization, architecture, operation and programmer's view, development environment, application-specific instruction-set processors (ASIP)." },
      { code: '4.5', title: 'Real-Time OS and Control Systems', desc: "OS basics, tasks/processes/threads, multiprocessing and multitasking, task scheduling, task synchronization, device drivers, open-loop and closed-loop control system overview." },
      { code: '4.6', title: 'HDL and IC Technology', desc: "VHDL overview, overflow and data representation using VHDL, design of combinational and sequential logic using VHDL, pipelining using VHDL." },
    ],
  },
  {
    num: 5, code: 'ACtE05',
    title: 'Concept of Computer Network and Network Security System',
    color: '#10b981',
    topics: [
      { code: '5.1', title: 'Introduction and Physical Layer', desc: "Networking models, protocols and standards, OSI model and TCP/IP model, networking devices (hubs, bridges, switches, routers) and transmission media." },
      { code: '5.2', title: 'Data Link Layer', desc: "Services, error detection and correction, flow control, data link protocol, multiple access protocols, LAN addressing and ARP, Ethernet, IEEE 802.3/802.4/802.5, CSMA/CD, wireless LANs, PPP, wide area protocols." },
      { code: '5.3', title: 'Network Layer', desc: "Internet addressing, classful address, subnetting, routing protocols (RIP, OSPF, BGP, unicast/multicast), routing algorithms (shortest path, flooding, distance vector, link state), ARP/RARP/IP/ICMP, IPv6 (packet formats, extension headers, IPv4-to-IPv6 transition, multicasting)." },
      { code: '5.4', title: 'Transport Layer', desc: "Transport service, transport protocols, ports and sockets, connection establishment and release, flow control and buffering, multiplexing/de-multiplexing, congestion control algorithms." },
      { code: '5.5', title: 'Application Layer', desc: "Web (HTTP/HTTPS), FTP, PuTTY, WinSCP, electronic mail, DNS, P2P applications, socket programming, application server concepts, traffic analyzers (MRTG, PRTG, SNMP, Packet Tracer, Wireshark)." },
      { code: '5.6', title: 'Network Security', desc: "Types of computer security and security attacks, cryptography principles, RSA algorithm, digital signatures, securing e-mail (PGP), SSL, network layer security (IPsec, VPN), wireless LAN security (WEP), firewalls." },
    ],
  },
  {
    num: 6, code: 'ACtE06',
    title: 'Theory of Computation and Computer Graphics',
    color: '#a855f7',
    topics: [
      { code: '6.1', title: 'Finite Automata', desc: "Introduction to finite automata and FSM, equivalence of DFA and NDFA, minimization of FSMs, regular expressions, equivalence of regular expression and finite automata, pumping lemma for regular languages." },
      { code: '6.2', title: 'Context-Free Languages', desc: "CFG, derivative trees, parse tree construction, ambiguous grammar, CNF, GNF, BNF, pushdown automata, equivalence of CFL and PDA, pumping lemma for CFLs, properties of context-free languages." },
      { code: '6.3', title: 'Turing Machines', desc: "Turing machine notation, acceptance of strings, TM as language recognizer/computing function/enumerator, multi-track/multi-tape TMs, non-deterministic TMs, Church-Turing thesis, universal Turing machine, computational complexity, time/space complexity, intractability, reducibility." },
      { code: '6.4', title: 'Introduction to Computer Graphics', desc: "Overview of computer graphics, graphics hardware (display technology, raster-scan displays, vector displays, display processors, output/input devices), graphics software and standards." },
      { code: '6.5', title: '2D Transformations', desc: "2D translation, rotation, scaling, reflection, shear transformation, 2D composite transformation, 2D viewing pipeline, world-to-screen viewing transformation, clipping (Cohen-Sutherland, Liang-Barsky)." },
      { code: '6.6', title: '3D Transformations', desc: "3D translation, rotation, scaling, reflection, shear transformation, 3D composite transformation, 3D viewing pipeline, projection concepts (orthographic, parallel, perspective projection)." },
    ],
  },
  {
    num: 7, code: 'ACtE07',
    title: 'Data Structures and Algorithm, Database System and Operating System',
    color: '#06b6d4',
    topics: [
      { code: '7.1', title: 'Data Structures, Lists and Trees', desc: "Data types, abstract data types, time/space analysis (Big-O, Omega, Theta). Stacks, queues, infix-to-postfix conversion, array implementation of lists. Singly, doubly, circular linked lists, basic linked-list operations. Binary trees, tree search, insertion/deletion, traversals (pre/in/post-order), height/level/depth, AVL balanced trees." },
      { code: '7.2', title: 'Sorting, Searching and Graphs', desc: "Internal/external sorting, insertion/selection/exchange/merge/radix/shell/heap sort, Big-O efficiency. Sequential/binary/tree search, hashing (hash functions, hash tables, collision resolution). Directed/undirected graphs, graph representation, transitive closure, Warshall's algorithm, DFS/BFS, topological sorting, MST (Prim's, Kruskal's), shortest-path (Greedy, Dijkstra's)." },
      { code: '7.3', title: 'Data Models, Normalization and SQL', desc: "Data abstraction and independence, schema and instances, E-R model, strong/weak entity sets, E-R diagrams. Normal forms (1NF, 2NF, 3NF, BCNF), functional dependencies, integrity/domain constraints, DDL/DML commands, views, assertions, triggers, relational algebra, query cost estimation, query optimization and decomposition." },
      { code: '7.4', title: 'Transaction Processing and Concurrency Control', desc: "ACID properties, concurrent executions, serializability, lock-based protocols, deadlock handling and prevention, failure classification, recovery and atomicity, log-based recovery." },
      { code: '7.5', title: 'Introduction to OS and Process Management', desc: "OS evolution, types, components, structure and services. Process description, states, control, threads, scheduling types. Concurrency principles, critical region, race condition, mutual exclusion, semaphores, mutex, message passing, monitors, classical synchronization problems." },
      { code: '7.6', title: 'Memory Management, File Systems and Administration', desc: "Memory addressing, swapping, free memory management, virtual memory, demand paging, page replacement algorithms. File and directory concepts, file system implementation, allocation policy and fragmentation, disk block mapping, file system performance. User account management, startup/shutdown procedures." },
    ],
  },
  {
    num: 8, code: 'ACtE08',
    title: 'Software Engineering and Object-Oriented Analysis & Design',
    color: '#3b82f6',
    topics: [
      { code: '8.1', title: 'Software Process and Requirements', desc: "Software characteristics, quality attributes, process models (Agile, V-Model, Iterative, Prototype, Big Bang), CASE tools. Functional/non-functional requirements, user/system requirements, interface specification, SRS document, requirements elicitation/analysis/validation/management." },
      { code: '8.2', title: 'Software Design', desc: "Design process, concepts, modes and heuristics. Architectural design decisions, system organization, modular decomposition, control styles, reference architectures, multiprocessor/client-server/distributed object architectures, real-time software design, component-based software engineering." },
      { code: '8.3', title: 'Testing, Cost Estimation and Quality Management', desc: "Unit, integration, system, component, acceptance testing. Test case design, test automation, metrics for testing. Algorithmic cost modeling, project duration and staffing. SQA, formal reviews, statistical SQA, ISO standards, CMMI, SQA plan. Configuration management: change management, version/release management, CASE tools." },
      { code: '8.4', title: 'OO Fundamentals and Analysis', desc: "Defining models, requirements process, use cases, OO development cycle, UML, building conceptual models, adding associations and attributes, representation of system behavior." },
      { code: '8.5', title: 'OO Design', desc: "Analysis to design, elaborating use cases, collaboration diagrams, objects and patterns, determining visibility, class diagrams." },
      { code: '8.6', title: 'OO Design Implementation', desc: "Programming and development process, mapping design to code, creating class definitions from design class diagrams, creating methods from collaboration diagrams, updating class definitions, classes in code, exception and error handling." },
    ],
  },
  {
    num: 9, code: 'ACtE09',
    title: 'Artificial Intelligence and Neural Networks',
    color: '#8b5cf6',
    topics: [
      { code: '9.1', title: 'Introduction to AI and Intelligent Agents', desc: "AI concepts, perspectives, history, applications, foundations. Intelligent agent structure and properties, PEAS description. Agent types: simple reflexive, model-based, goal-based, utility-based. Environment types: deterministic, stochastic, static, dynamic, observable, semi-observable, single/multi-agent." },
      { code: '9.2', title: 'Problem Solving and Searching Techniques', desc: "State space search, problem formulation, well-defined problems, constraint satisfaction. Uninformed search (DFS, BFS, DLS, IDS, bidirectional). Informed search (greedy best-first, A*, hill climbing, simulated annealing). Game playing, adversarial search, minimax, alpha-beta pruning." },
      { code: '9.3', title: 'Knowledge Representation', desc: "Knowledge representations and mappings, approaches and issues. Semantic nets, frames, propositional logic (syntax, semantics, formal logic, tautology, well-formed formula, resolution), predicate logic (FOPL, quantification, rules of inference, unification, resolution refutation), Bayes' rule, Bayesian networks, reasoning in belief networks." },
      { code: '9.4', title: 'Expert Systems and NLP', desc: "Expert system architecture, knowledge acquisition, declarative vs procedural knowledge, development of expert systems. NLP terminology, natural language understanding/generation, NLP steps, applications and challenges. Machine vision concepts and stages, robotics." },
      { code: '9.5', title: 'Machine Learning', desc: "Introduction to ML, concepts of learning. Supervised, unsupervised, reinforcement learning. Inductive learning (decision trees), statistical-based learning (Naive Bayes), fuzzy learning, fuzzy inference systems and methods. Genetic algorithms (operators, encoding, selection, fitness function, parameters)." },
      { code: '9.6', title: 'Neural Networks', desc: "Biological vs artificial neural networks, McCulloch-Pitts neuron, mathematical model of ANN, activation functions, architectures. Perceptron, learning rate, gradient descent, delta rule, Hebbian learning, Adaline. Multilayer perceptron, backpropagation algorithm, Hopfield neural network." },
    ],
  },
  {
    num: 10, code: 'AALL10',
    title: 'Project Planning, Design and Implementation',
    color: '#f97316',
    topics: [
      { code: '10.1', title: 'Engineering Drawings and Concepts', desc: "Fundamentals of standard drawing sheets, dimensions, scale, line diagrams, orthographic projection, isometric projection/view, pictorial views, sectional drawing." },
      { code: '10.2', title: 'Engineering Economics', desc: "Project cash flow, discount rate, interest and time value of money. Engineering economics analysis methodologies: Discounted Payback Period, NPV, IRR and MARR. Comparison of alternatives, depreciation system and taxation system in Nepal." },
      { code: '10.3', title: 'Project Planning and Scheduling', desc: "Project classifications, life cycle phases, planning process, scheduling (bar chart, CPM, PERT), resource levelling and smoothing, monitoring/evaluation/controlling." },
      { code: '10.4', title: 'Project Management', desc: "Information system, project risk analysis and management, project financing, tender and its process, contract management." },
      { code: '10.5', title: 'Engineering Professional Practice', desc: "Environment and society, professional ethics, regulatory environment, contemporary issues in engineering, occupational health and safety, roles and responsibilities of Nepal Engineers Association (NEA)." },
      { code: '10.6', title: 'Engineering Regulatory Body', desc: "Nepal Engineering Council (NEC) Acts and Regulations." },
    ],
  },
];

export default function BookPractice() {
  const bookChapters = useChapters();
  const [expandedChapter, setExpandedChapter] = useState<number | null>(null);

  const toggleChapter = (num: number) => {
    setExpandedChapter(prev => (prev === num ? null : num));
  };

  return (
    <div className="book-practice-page">
      <header className="page-header">
        <h1>Books & Syllabus</h1>
        <p>NEC Computer Engineering exam syllabus — practice questions and detailed topics for all 10 chapters.</p>
      </header>

      {/* Practice cards */}
      <section className="book-section">
        <h2 className="book-section-title">Practice by Chapter</h2>
        <div className="book-chapters-grid">
          {bookChapters.map((chapter) => {
            const tp = getTopicProgress(chapter.id);
            const attempted = tp.attempted.length;
            const correct = tp.correct.length;
            const progress = chapter.questionCount > 0
              ? Math.round((attempted / chapter.questionCount) * 100)
              : 0;
            const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;

            return (
              <div key={chapter.id} className="book-chapter-card" style={{ borderColor: chapter.color }}>
                <div className="chapter-card-header" style={{ background: `linear-gradient(135deg, ${chapter.color}22, ${chapter.color}44)` }}>
                  <div className="chapter-number-badge" style={{ backgroundColor: chapter.color }}>
                    {chapter.id.replace('book-ch', 'Ch')}
                  </div>
                  <div className="chapter-stats-top">
                    <span className="q-count">{chapter.questionCount} questions</span>
                    {attempted > 0 && (
                      <span className="accuracy-badge" style={{ color: chapter.color }}>
                        {accuracy}% accuracy
                      </span>
                    )}
                  </div>
                </div>

                <div className="chapter-card-body">
                  <h2>{chapter.name}</h2>
                  <p>{chapter.description}</p>

                  <div className="chapter-progress">
                    <div className="progress-label">
                      <span>Progress</span>
                      <span style={{ color: chapter.color }}>{progress}%</span>
                    </div>
                    <div className="progress-bar-container">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${progress}%`, backgroundColor: chapter.color }}
                      />
                    </div>
                    <span className="progress-detail">{attempted} / {chapter.questionCount} attempted</span>
                  </div>
                </div>

                <div className="chapter-card-footer">
                  <Link
                    to={`/app/practice/chapter/${chapter.id}`}
                    className="chapter-practice-btn"
                    style={{ backgroundColor: chapter.color }}
                  >
                    Practice Now
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Full syllabus */}
      <section className="book-section">
        <h2 className="book-section-title">
          Nepal Engineering Council — Computer Engineering Syllabus (ACtE)
        </h2>
        <p className="book-section-sub">
          Chapters 1–2 are fundamentals; chapters 3–9 are application-focused; chapter 10 covers project planning, design and implementation.
        </p>

        <div className="syllabus-accordion">
          {SYLLABUS.map(ch => (
            <div
              key={ch.num}
              className={`syllabus-chapter ${expandedChapter === ch.num ? 'open' : ''}`}
              style={{ '--ch-color': ch.color } as React.CSSProperties}
            >
              <button
                className="syllabus-chapter-header"
                onClick={() => toggleChapter(ch.num)}
                aria-expanded={expandedChapter === ch.num}
              >
                <span className="syllabus-num-badge" style={{ backgroundColor: ch.color }}>
                  {ch.num}
                </span>
                <span className="syllabus-chapter-title">
                  <strong>{ch.title}</strong>
                  <span className="syllabus-code">{ch.code}</span>
                </span>
                <span className="syllabus-topic-count">{ch.topics.length} topics</span>
                <svg
                  className="syllabus-chevron"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {expandedChapter === ch.num && (
                <div className="syllabus-topics">
                  {ch.topics.map(t => (
                    <div key={t.code} className="syllabus-topic-item">
                      <div className="syllabus-topic-header">
                        <span className="syllabus-topic-code" style={{ color: ch.color }}>{t.code}</span>
                        <span className="syllabus-topic-title">{t.title}</span>
                      </div>
                      <p className="syllabus-topic-desc">{t.desc}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}
