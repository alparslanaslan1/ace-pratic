(function () {
  "use strict";

  var WRONG_KEY = "ace_ce_wrong_v1";
  var EXAM_SIZE = 50;
  var EXAM_PASS_PCT = 70;

  var MODE_LABELS = {
    all: "Tüm Sorular (Karışık)",
    sirali: "Sıralı Sorular",
    exam: "Sınav Modu (50 Rastgele)",
    multi: "Çoklu Cevaplı (Karışık)",
    multi_sirali: "Çoklu Cevaplı (Sıralı)",
    bson: "Benzersiz Son Kelime (Karışık)",
    bson_sirali: "Benzersiz Son Kelime (Sıralı)",
    bson2: "Benzersiz Son Kelime 2 (Karışık)",
    bson2_sirali: "Benzersiz Son Kelime 2 (Sıralı)",
    bilk: "Benzersiz İlk Kelime (Karışık)",
    bilk_sirali: "Benzersiz İlk Kelime (Sıralı)",
    wrong: "Yanlışlarım"
  };

  var state = {
    mode: null,
    questions: [],
    currentIndex: 0,
    correctCount: 0,
    qStates: [] // per-question: { shuffledLetters, answered, selected }
  };

  var screenMenu = document.getElementById("screen-menu");
  var screenQuiz = document.getElementById("screen-quiz");
  var screenCard = document.getElementById("screen-card");
  var screenResults = document.getElementById("screen-results");

  var modeLabelEl = document.getElementById("mode-label");
  var progressText = document.getElementById("progress-text");
  var realQnoEl = document.getElementById("real-qno");
  var questionTextEl = document.getElementById("question-text");
  var optionsContainer = document.getElementById("options-container");
  var multiSubmitWrap = document.getElementById("multi-submit-wrap");
  var btnSubmitMulti = document.getElementById("btn-submit-multi");
  var btnNext = document.getElementById("btn-next");
  var btnPrev = document.getElementById("btn-prev");

  var resultsScore = document.getElementById("results-score");
  var resultsPercent = document.getElementById("results-percent");
  var resultsPass = document.getElementById("results-pass");
  var btnRetry = document.getElementById("btn-retry");
  var btnMenu = document.getElementById("btn-menu");

  // ---------- Word-uniqueness analysis (Benzersiz Son/Son2/İlk Kelime) ----------

  function normWord(w) {
    return (w || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  function wordsOf(t) {
    return (t || "").trim().split(/\s+/);
  }
  function lastWord(t) {
    var w = wordsOf(t);
    return normWord(w[w.length - 1] || "");
  }
  function firstWord(t) {
    return normWord(wordsOf(t)[0] || "");
  }
  function lastTwoWords(t) {
    var w = wordsOf(t);
    return w.slice(-2).map(normWord).join(" ");
  }

  var POOLS = { all: [], multi: [], bson: [], bson2: [], bilk: [] };

  (function buildPools() {
    QUESTIONS.forEach(function (q) {
      if (!q.correct || q.correct.length === 0) return; // eksik cevaplı soruları hariç tut
      POOLS.all.push(q);

      if (q.correct.length > 1) {
        POOLS.multi.push(q);
        return;
      }

      var letters = Object.keys(q.options);
      var correctLetter = q.correct[0];
      var correctText = q.options[correctLetter];
      var others = letters
        .filter(function (l) { return l !== correctLetter; })
        .map(function (l) { return q.options[l]; });

      var lw = lastWord(correctText);
      if (lw && others.every(function (t) { return lastWord(t) !== lw; })) {
        POOLS.bson.push(q);
        return;
      }

      var fw = firstWord(correctText);
      if (fw && others.every(function (t) { return firstWord(t) !== fw; })) {
        POOLS.bilk.push(q);
        return;
      }

      var l2 = lastTwoWords(correctText);
      if (l2 && others.every(function (t) { return lastTwoWords(t) !== l2; })) {
        POOLS.bson2.push(q);
      }
    });
  })();

  // ---------- Wrong-answer tracking (localStorage) ----------

  function loadWrongIds() {
    try {
      var raw = localStorage.getItem(WRONG_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveWrongIds(ids) {
    try {
      localStorage.setItem(WRONG_KEY, JSON.stringify(ids));
    } catch (e) { /* ignore quota/private-mode errors */ }
  }

  function recordResult(id, isCorrect) {
    var ids = loadWrongIds();
    var idx = ids.indexOf(id);
    if (isCorrect) {
      if (idx !== -1) ids.splice(idx, 1);
    } else {
      if (idx === -1) ids.push(id);
    }
    saveWrongIds(ids);
  }

  function updateMenuBadges() {
    document.getElementById("badge-all").textContent = POOLS.all.length;
    document.getElementById("badge-multi").textContent = POOLS.multi.length;
    document.getElementById("badge-bson").textContent = POOLS.bson.length;
    document.getElementById("badge-bson2").textContent = POOLS.bson2.length;
    document.getElementById("badge-bilk").textContent = POOLS.bilk.length;
    document.getElementById("badge-wrong").textContent = loadWrongIds().length;

    var noteParts = [];
    var noAnswerCount = QUESTIONS.filter(function (q) { return !q.correct || q.correct.length === 0; }).length;
    if (noAnswerCount > 0) {
      noteParts.push(noAnswerCount + " soru cevapsız olduğu için havuzdan hariç tutuldu");
    }
    document.getElementById("footer-note").textContent =
      "Toplam " + QUESTIONS.length + " soru yüklü" + (noteParts.length ? " · " + noteParts.join(", ") : "") + ".";
  }

  // ---------- Quiz engine ----------

  function shuffleArray(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  function showScreen(screen) {
    screenMenu.style.display = "none";
    screenQuiz.style.display = "none";
    screenCard.style.display = "none";
    screenResults.style.display = "none";
    screen.style.display = "block";
    if (screen === screenMenu) updateMenuBadges();
  }

  function getQuestionsForMode(mode) {
    switch (mode) {
      case "sirali": return POOLS.all.slice();
      case "all": return shuffleArray(POOLS.all);
      case "exam": return shuffleArray(POOLS.all).slice(0, EXAM_SIZE);
      case "multi": return shuffleArray(POOLS.multi);
      case "multi_sirali": return POOLS.multi.slice();
      case "bson": return shuffleArray(POOLS.bson);
      case "bson_sirali": return POOLS.bson.slice();
      case "bson2": return shuffleArray(POOLS.bson2);
      case "bson2_sirali": return POOLS.bson2.slice();
      case "bilk": return shuffleArray(POOLS.bilk);
      case "bilk_sirali": return POOLS.bilk.slice();
      case "wrong":
        var wrongIds = loadWrongIds();
        var pool = POOLS.all.filter(function (q) { return wrongIds.indexOf(q.id) !== -1; });
        return shuffleArray(pool);
      default: return shuffleArray(POOLS.all);
    }
  }

  function startQuiz(mode) {
    cardState.active = false;
    var questions = getQuestionsForMode(mode);
    if (questions.length === 0) {
      alert("Bu modda henüz soru yok.");
      return;
    }
    state.mode = mode;
    state.questions = questions;
    state.currentIndex = 0;
    state.correctCount = 0;
    state.qStates = [];
    showScreen(screenQuiz);
    renderQuestion();
  }

  function letterList(count) {
    var letters = ["A", "B", "C", "D", "E", "F"];
    return letters.slice(0, count);
  }

  function getQState(index) {
    if (!state.qStates[index]) {
      var q = state.questions[index];
      var totalLetters = Object.keys(q.options).filter(function (k) {
        return q.options[k] !== undefined && q.options[k] !== null && q.options[k] !== "";
      });
      state.qStates[index] = {
        shuffledLetters: shuffleArray(totalLetters),
        answered: false,
        selected: []
      };
    }
    return state.qStates[index];
  }

  function updateProgressText() {
    progressText.textContent =
      "Soru " + (state.currentIndex + 1) + " / " + state.questions.length +
      ", Doğru: " + state.correctCount;
  }

  function updateNavButtons() {
    btnPrev.style.display = state.currentIndex > 0 ? "inline-block" : "none";
    btnNext.style.display = "inline-block";
    btnNext.textContent = (state.currentIndex === state.questions.length - 1)
      ? "Sonuçları Gör"
      : "Sonraki Soru →";
  }

  function renderQuestion() {
    var q = state.questions[state.currentIndex];
    var qs = getQState(state.currentIndex);
    var isMulti = q.correct.length > 1;

    modeLabelEl.textContent = MODE_LABELS[state.mode] || "";
    realQnoEl.textContent = "Gerçek Soru No: " + q.id;
    updateProgressText();

    questionTextEl.textContent = q.text;
    optionsContainer.innerHTML = "";

    qs.shuffledLetters.forEach(function (origLetter, idx) {
      var displayLetter = letterList(qs.shuffledLetters.length)[idx];
      var optDiv = document.createElement("div");
      optDiv.className = "option";
      optDiv.dataset.origLetter = origLetter;

      if (isMulti) {
        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = "opt-" + origLetter;
        if (qs.answered) {
          checkbox.checked = qs.selected.indexOf(origLetter) !== -1;
          checkbox.disabled = true;
        }
        optDiv.appendChild(checkbox);
      }

      var letterSpan = document.createElement("span");
      letterSpan.className = "option-letter";
      letterSpan.textContent = displayLetter + ".";
      optDiv.appendChild(letterSpan);

      var textSpan = document.createElement("span");
      textSpan.textContent = q.options[origLetter];
      optDiv.appendChild(textSpan);

      if (qs.answered) {
        optDiv.classList.add("locked");
      } else if (isMulti) {
        optDiv.addEventListener("click", function (e) {
          if (e.target.tagName !== "INPUT") {
            var cb = optDiv.querySelector("input[type=checkbox]");
            cb.checked = !cb.checked;
          }
        });
      } else {
        optDiv.addEventListener("click", function () {
          handleSingleAnswer(q, qs, origLetter);
        });
      }

      optionsContainer.appendChild(optDiv);
    });

    if (qs.answered) {
      applyAnswerStyling(q, qs, isMulti);
    }

    if (isMulti && !qs.answered) {
      multiSubmitWrap.style.display = "flex";
      btnSubmitMulti.onclick = function () {
        handleMultiAnswer(q, qs);
      };
    } else {
      multiSubmitWrap.style.display = "none";
    }

    updateNavButtons();
  }

  function applyAnswerStyling(q, qs, isMulti) {
    var opts = optionsContainer.querySelectorAll(".option");
    opts.forEach(function (opt) {
      var origLetter = opt.dataset.origLetter;
      var isCorrectOption = q.correct.indexOf(origLetter) !== -1;
      var isSelected = qs.selected.indexOf(origLetter) !== -1;

      if (isSelected && isCorrectOption) {
        opt.classList.add("correct");
      } else if (isSelected && !isCorrectOption) {
        opt.classList.add("wrong");
      } else if (!isSelected && isCorrectOption) {
        opt.classList.add("correct");
        if (isMulti) {
          var tag = document.createElement("span");
          tag.className = "correct-tag";
          tag.textContent = "(doğru cevap)";
          opt.appendChild(tag);
        }
      }
    });
  }

  function handleSingleAnswer(q, qs, clickedLetter) {
    qs.answered = true;
    qs.selected = [clickedLetter];

    var isCorrect = clickedLetter === q.correct[0];
    if (isCorrect) state.correctCount++;
    recordResult(q.id, isCorrect);

    renderQuestion();
  }

  function handleMultiAnswer(q, qs) {
    var opts = optionsContainer.querySelectorAll(".option");
    var checkedLetters = [];
    opts.forEach(function (opt) {
      var cb = opt.querySelector("input[type=checkbox]");
      if (cb && cb.checked) {
        checkedLetters.push(opt.dataset.origLetter);
      }
    });

    qs.answered = true;
    qs.selected = checkedLetters;

    var correctSet = q.correct.slice().sort();
    var checkedSet = checkedLetters.slice().sort();
    var isFullyCorrect =
      correctSet.length === checkedSet.length &&
      correctSet.every(function (l, i) { return l === checkedSet[i]; });

    if (isFullyCorrect) state.correctCount++;
    recordResult(q.id, isFullyCorrect);

    renderQuestion();
  }

  function goToQuestion(newIndex) {
    if (newIndex < 0) return;
    if (newIndex >= state.questions.length) {
      showResults();
      return;
    }
    state.currentIndex = newIndex;
    renderQuestion();
  }

  function nextQuestion() {
    goToQuestion(state.currentIndex + 1);
  }

  function prevQuestion() {
    goToQuestion(state.currentIndex - 1);
  }

  function showResults() {
    showScreen(screenResults);
    var total = state.questions.length;
    var pct = total === 0 ? 0 : Math.round((state.correctCount / total) * 100);
    resultsScore.textContent = "Doğru: " + state.correctCount + " / " + total;
    resultsPercent.textContent = "Başarı: %" + pct;

    if (state.mode === "exam") {
      var passed = pct >= EXAM_PASS_PCT;
      resultsPass.style.display = "inline-block";
      resultsPass.className = "results-pass " + (passed ? "pass" : "fail");
      resultsPass.textContent = (passed ? "✓ Geçer not (tahmini %" : "✗ Geçemedi (tahmini %") + EXAM_PASS_PCT + " eşiğe göre)";
    } else {
      resultsPass.style.display = "none";
    }
  }

  // ---------- Card (flashcard) engine ----------

  var CARD_LABELS = {
    bson: "Benzersiz Son Kelime",
    bson2: "Benzersiz Son 2 Kelime",
    bilk: "Benzersiz İlk Kelime"
  };

  var cardState = {
    pool: "bson",
    questions: [],
    index: 0,
    flipped: false,
    scores: [], // per card: null | "correct" | "wrong"
    active: false
  };

  function getKeyword(q, pool) {
    var cl = q.correct[0];
    var ct = q.options[cl];
    if (pool === "bilk") return wordsOf(ct)[0];
    if (pool === "bson2") return wordsOf(ct).slice(-2).join(" ");
    return wordsOf(ct).slice(-1)[0]; // bson
  }

  function getHintLabel(pool) {
    if (pool === "bilk") return "İlk Kelime";
    if (pool === "bson2") return "Son 2 Kelime";
    return "Son Kelime";
  }

  function startCards(pool) {
    var src = POOLS[pool];
    if (!src || src.length === 0) { alert("Bu modda soru yok."); return; }
    cardState.pool = pool;
    cardState.questions = shuffleArray(src);
    cardState.index = 0;
    cardState.flipped = false;
    cardState.scores = new Array(cardState.questions.length).fill(null);
    cardState.active = true;
    showScreen(screenCard);
    renderCard();
  }

  function renderCard() {
    var q = cardState.questions[cardState.index];
    var pool = cardState.pool;
    var cl = q.correct[0];
    var ct = q.options[cl];
    var keyword = getKeyword(q, pool);

    // header
    document.getElementById("card-mode-label").textContent = CARD_LABELS[pool] + " · 🃏 Kart Modu";
    var correct = cardState.scores.filter(function(s){ return s === "correct"; }).length;
    var wrong   = cardState.scores.filter(function(s){ return s === "wrong"; }).length;
    document.getElementById("card-progress").textContent =
      (cardState.index + 1) + " / " + cardState.questions.length +
      "  ✓ " + correct + "  ✗ " + wrong;

    // front
    document.getElementById("card-qno").textContent = "Soru " + q.id;
    document.getElementById("card-hint-label").textContent = getHintLabel(pool);
    document.getElementById("card-keyword").textContent = keyword;

    // back
    document.getElementById("card-back-answer").textContent = ct;
    document.getElementById("card-back-question").textContent = q.text;

    // reset flip
    cardState.flipped = false;
    document.getElementById("flashcard-inner").classList.remove("flipped");

    // nav
    var isLast = cardState.index === cardState.questions.length - 1;
    document.getElementById("btn-card-prev").style.display = cardState.index > 0 ? "inline-block" : "none";
    document.getElementById("btn-card-next").style.display = isLast ? "none" : "inline-block";
  }

  document.getElementById("btn-reveal").addEventListener("click", function () {
    if (cardState.flipped) return;
    cardState.flipped = true;
    document.getElementById("flashcard-inner").classList.add("flipped");
  });

  function cardVerdict(verdict) {
    cardState.scores[cardState.index] = verdict;
    var isLast = cardState.index === cardState.questions.length - 1;
    if (isLast) {
      // Show summary on results screen
      var correct = cardState.scores.filter(function(s){ return s === "correct"; }).length;
      var total = cardState.questions.length;
      var pct = Math.round((correct / total) * 100);
      showScreen(screenResults);
      resultsScore.textContent = "Bildim: " + correct + " / " + total;
      resultsPercent.textContent = "Başarı: %" + pct;
      resultsPass.style.display = "none";
    } else {
      cardState.index++;
      renderCard();
    }
  }

  document.getElementById("btn-card-wrong").addEventListener("click", function () {
    cardVerdict("wrong");
  });
  document.getElementById("btn-card-correct").addEventListener("click", function () {
    cardVerdict("correct");
  });

  document.getElementById("btn-card-prev").addEventListener("click", function () {
    if (cardState.index > 0) { cardState.index--; renderCard(); }
  });
  document.getElementById("btn-card-next").addEventListener("click", function () {
    if (cardState.index < cardState.questions.length - 1) { cardState.index++; renderCard(); }
  });
  document.getElementById("btn-card-menu").addEventListener("click", function () {
    showScreen(screenMenu);
  });

  document.querySelectorAll(".card-btn[data-card]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      startCards(btn.dataset.card);
    });
  });

  // Spacebar / arrow keys for card mode
  document.addEventListener("keydown", function (e) {
    if (screenCard.style.display !== "block") return;
    if (e.key === " " || e.key === "Enter") {
      if (!cardState.flipped) {
        document.getElementById("btn-reveal").click();
      }
    } else if (e.key === "ArrowRight" && cardState.flipped) {
      cardVerdict("correct");
    } else if (e.key === "ArrowLeft" && cardState.flipped) {
      cardVerdict("wrong");
    }
  });

  // ---------- btnRetry: handle card mode re-start ----------

  // Event wiring
  document.querySelectorAll(".mode-btn[data-mode]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      startQuiz(btn.dataset.mode);
    });
  });

  document.getElementById("btn-reset-wrong").addEventListener("click", function () {
    if (confirm("Yanlışlarım listesini sıfırlamak istediğine emin misin?")) {
      saveWrongIds([]);
      updateMenuBadges();
    }
  });

  btnNext.addEventListener("click", nextQuestion);
  btnPrev.addEventListener("click", prevQuestion);

  document.addEventListener("keydown", function (e) {
    if (screenQuiz.style.display !== "block") return;
    if (e.key === "ArrowRight") {
      nextQuestion();
    } else if (e.key === "ArrowLeft") {
      prevQuestion();
    }
  });

  btnRetry.addEventListener("click", function () {
    if (cardState.active) {
      startCards(cardState.pool);
    } else {
      startQuiz(state.mode);
    }
  });

  btnMenu.addEventListener("click", function () {
    showScreen(screenMenu);
  });

  updateMenuBadges();

})();
