// Affiche les actualités du fichier actualites.json dans chaque liste [data-actualites].
// data-actualites="3" limite le nombre d'actualités affichées ; vide, elles sont toutes affichées.
// Les textes sont bilingues (data-en) comme le reste du site : le bouton FR/EN les bascule.
(function(){
 var listes=document.querySelectorAll('[data-actualites]');
 if(!listes.length)return;
 function echappe(t){return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
 function laDate(iso,l){return new Date(iso+'T12:00:00').toLocaleDateString(l==='en'?'en-GB':'fr-FR',{day:'numeric',month:'long',year:'numeric'})}
 function bilingue(balise,fr,en){
  var el=document.createElement(balise),s=document.createElement('span');
  s.textContent=fr;
  s.setAttribute('data-en',echappe(en));
  // la page est peut-être déjà en anglais : on bascule tout de suite ce nouveau texte
  if(document.documentElement.lang==='en'){s.dataset.fr=s.innerHTML;s.innerHTML=s.dataset.en}
  el.appendChild(s);
  return el;
 }
 fetch('actualites.json',{cache:'no-cache'}).then(function(r){return r.json()}).then(function(actus){
  actus.sort(function(a,b){return a.date<b.date?1:-1});
  listes.forEach(function(liste){
   var max=parseInt(liste.getAttribute('data-actualites'),10)||actus.length;
   actus.slice(0,max).forEach(function(a){
    var li=document.createElement('li'),t=bilingue('time',laDate(a.date,'fr'),laDate(a.date,'en'));
    t.setAttribute('datetime',a.date);
    li.appendChild(t);
    li.appendChild(bilingue('h3',a.titre.fr,a.titre.en));
    li.appendChild(bilingue('p',a.texte.fr,a.texte.en));
    liste.appendChild(li);
   });
   var section=liste.closest('[data-masquer-si-vide]');
   if(section)section.hidden=!liste.children.length;
  });
 }).catch(function(){});
})();
